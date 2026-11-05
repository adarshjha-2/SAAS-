"""Pure-ASGI middleware: request correlation, security headers, body limits.

These are written as raw ASGI callables (not ``BaseHTTPMiddleware``) so they
add no buffering, work with streaming responses, and pass WebSocket traffic
through untouched.
"""

from __future__ import annotations

import json
import logging
import re
import time
import uuid
from collections.abc import Iterable
from typing import Any

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from nexus_hash.core.errors import INTERNAL_ERROR_MESSAGE, ErrorCode, error_payload
from nexus_hash.core.logging import request_id_var

access_logger = logging.getLogger("nexus_hash.access")
error_logger = logging.getLogger("nexus_hash.errors")

REQUEST_ID_HEADER = "x-request-id"
_VALID_REQUEST_ID = re.compile(r"^[A-Za-z0-9._\-]{1,128}$")


def _header(scope: Scope, name: bytes) -> str | None:
    for key, value in scope.get("headers", []):
        if key == name:
            decoded: str = value.decode("latin-1")
            return decoded
    return None


async def _send_json(send: Send, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload).encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


class RequestContextMiddleware:
    """Assigns a request ID, emits an access log line, and is the last line of
    defence for unhandled exceptions (which become a generic 500 envelope)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        inbound = _header(scope, REQUEST_ID_HEADER.encode())
        valid = inbound is not None and _VALID_REQUEST_ID.fullmatch(inbound) is not None
        request_id = inbound if valid and inbound is not None else uuid.uuid4().hex
        scope.setdefault("state", {})["request_id"] = request_id
        token = request_id_var.set(request_id)

        started = time.perf_counter()
        status_holder: dict[str, int] = {"status": 500}
        response_started = False

        async def send_wrapper(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
                status_holder["status"] = message["status"]
                headers = MutableHeaders(scope=message)
                headers[REQUEST_ID_HEADER] = request_id
                elapsed_ms = (time.perf_counter() - started) * 1000
                headers["server-timing"] = f"app;dur={elapsed_ms:.1f}"
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            error_logger.exception("Unhandled exception while serving request")
            if response_started:
                raise
            await send_wrapper(
                {
                    "type": "http.response.start",
                    "status": 500,
                    "headers": [(b"content-type", b"application/json")],
                }
            )
            body = json.dumps(
                error_payload(ErrorCode.INTERNAL_ERROR, INTERNAL_ERROR_MESSAGE, request_id)
            ).encode()
            await send({"type": "http.response.body", "body": body})
        finally:
            duration_ms = (time.perf_counter() - started) * 1000
            access_logger.info(
                "%s %s %s",
                scope.get("method", "-"),
                scope.get("path", "-"),
                status_holder["status"],
                extra={
                    "fields": {
                        "method": scope.get("method"),
                        "path": scope.get("path"),
                        "status": status_holder["status"],
                        "duration_ms": round(duration_ms, 2),
                    }
                },
            )
            request_id_var.reset(token)


DEFAULT_SECURITY_HEADERS: dict[str, str] = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
}
# The API serves JSON only, so the strictest CSP applies. Interactive docs
# pages load their UI bundle from a CDN and are exempted (dev only by default).
API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp, csp_exempt_paths: Iterable[str] = ()) -> None:
        self.app = app
        self.csp_exempt_paths = tuple(csp_exempt_paths)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path: str = scope.get("path", "")
        apply_csp = not any(path.startswith(prefix) for prefix in self.csp_exempt_paths)

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in DEFAULT_SECURITY_HEADERS.items():
                    headers.setdefault(name, value)
                if apply_csp:
                    headers.setdefault("content-security-policy", API_CSP)
                headers.setdefault("cache-control", "no-store")
            await send(message)

        await self.app(scope, receive, send_wrapper)


class _BodyTooLargeError(Exception):
    pass


class BodySizeLimitMiddleware:
    """Rejects request bodies over ``max_bytes`` with 413, whether or not the
    client declares ``Content-Length`` (chunked uploads are counted)."""

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        declared = _header(scope, b"content-length")
        if declared is not None:
            try:
                too_large = int(declared) > self.max_bytes
            except ValueError:
                await self._reject(
                    scope, send, 400, ErrorCode.BAD_REQUEST, "Invalid Content-Length."
                )
                return
            if too_large:
                await self._reject_too_large(scope, send)
                return

        received = 0
        response_started = False

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise _BodyTooLargeError
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracking_send)
        except _BodyTooLargeError:
            if response_started:
                raise
            await self._reject_too_large(scope, send)

    async def _reject_too_large(self, scope: Scope, send: Send) -> None:
        await self._reject(
            scope,
            send,
            413,
            ErrorCode.PAYLOAD_TOO_LARGE,
            f"Request body exceeds the {self.max_bytes}-byte limit.",
        )

    @staticmethod
    async def _reject(scope: Scope, send: Send, status: int, code: str, message: str) -> None:
        request_id = scope.get("state", {}).get("request_id")
        await _send_json(send, status, error_payload(code, message, request_id))
