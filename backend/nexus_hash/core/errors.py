"""Error taxonomy and the uniform JSON error envelope.

Every error response from the API has the shape::

    {"error": {"code": "...", "message": "...", "request_id": "...", "details": [...]}}

Internal details (stack traces, exception text) are logged server-side and
never returned to clients.
"""

from __future__ import annotations

import logging
from enum import StrEnum
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("nexus_hash.errors")


class ErrorCode(StrEnum):
    BAD_REQUEST = "bad_request"
    UNAUTHORIZED = "unauthorized"
    FORBIDDEN = "forbidden"
    NOT_FOUND = "not_found"
    METHOD_NOT_ALLOWED = "method_not_allowed"
    CONFLICT = "conflict"
    PAYLOAD_TOO_LARGE = "payload_too_large"
    VALIDATION_ERROR = "validation_error"
    PERMISSION_REQUIRED = "permission_required"
    RESOURCE_LIMIT = "resource_limit_exceeded"
    RATE_LIMITED = "rate_limited"
    INTERNAL_ERROR = "internal_error"
    UPSTREAM_UNAVAILABLE = "upstream_unavailable"
    SERVICE_UNAVAILABLE = "service_unavailable"
    HTTP_ERROR = "http_error"


_STATUS_TO_CODE: dict[int, ErrorCode] = {
    400: ErrorCode.BAD_REQUEST,
    401: ErrorCode.UNAUTHORIZED,
    403: ErrorCode.FORBIDDEN,
    404: ErrorCode.NOT_FOUND,
    405: ErrorCode.METHOD_NOT_ALLOWED,
    409: ErrorCode.CONFLICT,
    413: ErrorCode.PAYLOAD_TOO_LARGE,
    422: ErrorCode.VALIDATION_ERROR,
    429: ErrorCode.RATE_LIMITED,
    503: ErrorCode.SERVICE_UNAVAILABLE,
}

INTERNAL_ERROR_MESSAGE = (
    "An unexpected error occurred. Quote the request ID when reporting this issue."
)


class ErrorBody(BaseModel):
    code: str
    message: str
    request_id: str | None = None
    details: list[dict[str, Any]] | None = None


class ErrorResponse(BaseModel):
    error: ErrorBody


class AppError(Exception):
    """Base class for expected, client-facing errors."""

    status_code: int = 500
    code: ErrorCode = ErrorCode.INTERNAL_ERROR

    def __init__(
        self,
        message: str,
        *,
        details: list[dict[str, Any]] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.details = details


class NotFoundError(AppError):
    status_code = 404
    code = ErrorCode.NOT_FOUND


class ConflictError(AppError):
    status_code = 409
    code = ErrorCode.CONFLICT


class PermissionRequiredError(AppError):
    """Raised when an action needs explicit user consent (e.g. intensive workloads)."""

    status_code = 403
    code = ErrorCode.PERMISSION_REQUIRED


class ResourceLimitError(AppError):
    status_code = 422
    code = ErrorCode.RESOURCE_LIMIT


class UpstreamUnavailableError(AppError):
    status_code = 503
    code = ErrorCode.UPSTREAM_UNAVAILABLE


def request_id_of(request: Request) -> str | None:
    value = getattr(request.state, "request_id", None)
    return value if isinstance(value, str) else None


def error_payload(
    code: str,
    message: str,
    request_id: str | None,
    details: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    body = ErrorBody(code=code, message=message, request_id=request_id, details=details)
    return ErrorResponse(error=body).model_dump(exclude_none=True)


def _sanitize_validation_errors(errors: Any) -> list[dict[str, Any]]:
    """Keep location, message and type; drop echoed input and internal context."""
    return [
        {
            "loc": list(err.get("loc", ())),
            "msg": str(err.get("msg", "")),
            "type": str(err.get("type", "")),
        }
        for err in errors
    ]


async def _handle_app_error(request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, AppError):  # pragma: no cover - guaranteed by registration
        raise exc
    return JSONResponse(
        status_code=exc.status_code,
        content=error_payload(exc.code, exc.message, request_id_of(request), exc.details),
    )


async def _handle_http_exception(request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, StarletteHTTPException):  # pragma: no cover - guaranteed by registration
        raise exc
    code = _STATUS_TO_CODE.get(exc.status_code, ErrorCode.HTTP_ERROR)
    message = exc.detail if isinstance(exc.detail, str) else code.replace("_", " ")
    return JSONResponse(
        status_code=exc.status_code,
        content=error_payload(code, message, request_id_of(request)),
        headers=getattr(exc, "headers", None),
    )


async def _handle_validation_error(request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, RequestValidationError):  # pragma: no cover - guaranteed by registration
        raise exc
    return JSONResponse(
        status_code=422,
        content=error_payload(
            ErrorCode.VALIDATION_ERROR,
            "Request validation failed.",
            request_id_of(request),
            _sanitize_validation_errors(exc.errors()),
        ),
    )


def install_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, _handle_app_error)
    app.add_exception_handler(StarletteHTTPException, _handle_http_exception)
    app.add_exception_handler(RequestValidationError, _handle_validation_error)
