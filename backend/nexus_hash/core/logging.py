"""Structured logging with request correlation and secret redaction."""

from __future__ import annotations

import json
import logging
import sys
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)

_HANDLER_MARKER = "_nexus_hash_handler"
_REDACTED = "***REDACTED***"
_MIN_SECRET_LENGTH = 8


class RequestIdFilter(logging.Filter):
    """Attach the current request ID (or ``-``) to every record."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get() or "-"
        return True


class SecretRedactionFilter(logging.Filter):
    """Defense in depth: scrub known secret values from rendered messages."""

    def __init__(self, secrets: list[str]) -> None:
        super().__init__()
        # Ignore trivially short values to avoid redacting ordinary words.
        self._secrets = [s for s in secrets if len(s) >= _MIN_SECRET_LENGTH]

    def filter(self, record: logging.LogRecord) -> bool:
        if not self._secrets:
            return True
        message = record.getMessage()
        redacted = message
        for secret in self._secrets:
            redacted = redacted.replace(secret, _REDACTED)
        if redacted != message:
            record.msg = redacted
            record.args = None
        return True


class JsonFormatter(logging.Formatter):
    """One JSON object per line; suitable for log shippers."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", "-"),
        }
        fields = getattr(record, "fields", None)
        if isinstance(fields, dict):
            payload.update(fields)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


class ConsoleFormatter(logging.Formatter):
    """Readable single-line format for local development."""

    def __init__(self) -> None:
        super().__init__("%(asctime)s %(levelname)-7s [%(request_id)s] %(name)s: %(message)s")

    def format(self, record: logging.LogRecord) -> str:
        line = super().format(record)
        fields = getattr(record, "fields", None)
        if isinstance(fields, dict) and fields:
            rendered = " ".join(f"{key}={value}" for key, value in fields.items())
            line = f"{line} | {rendered}"
        return line


def configure_logging(level: str, fmt: str, secrets: list[str] | None = None) -> None:
    """Install the NEXUS handler on the root logger. Safe to call repeatedly."""
    root = logging.getLogger()
    for handler in list(root.handlers):
        if getattr(handler, _HANDLER_MARKER, False):
            root.removeHandler(handler)

    handler = logging.StreamHandler(sys.stderr)
    setattr(handler, _HANDLER_MARKER, True)
    handler.addFilter(RequestIdFilter())
    handler.addFilter(SecretRedactionFilter(secrets or []))
    handler.setFormatter(JsonFormatter() if fmt == "json" else ConsoleFormatter())

    root.addHandler(handler)
    root.setLevel(level)
    # Uvicorn's own access log is replaced by our correlated access log.
    logging.getLogger("uvicorn.access").disabled = True
