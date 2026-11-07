"""Map database failures to the API error envelope."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError

from nexus_hash.core.errors import ErrorCode, error_payload, request_id_of

logger = logging.getLogger("nexus_hash.db")


async def _handle_operational_error(request: Request, exc: Exception) -> JSONResponse:
    # Locked, missing or corrupt database: a server-side availability problem.
    logger.error("database operation failed", exc_info=exc)
    return JSONResponse(
        status_code=503,
        content=error_payload(
            ErrorCode.SERVICE_UNAVAILABLE, "The database is unavailable.", request_id_of(request)
        ),
    )


def install_database_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(OperationalError, _handle_operational_error)
