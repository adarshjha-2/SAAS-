"""Activity log API contract."""

from __future__ import annotations

import json
from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_CONTEXT_BYTES = 4_096


class ActivityLevel(StrEnum):
    INFO = "info"
    SUCCESS = "success"
    WARNING = "warning"
    ERROR = "error"


class ActivityCategory(StrEnum):
    """The subsystem an entry is about."""

    SYSTEM = "system"
    DATABASE = "database"
    HASHLAB = "hashlab"
    HARDWARE = "hardware"
    NETWORK = "network"
    PROFITABILITY = "profitability"
    INTELLIGENCE = "intelligence"
    CORE = "core"


class ActivityActor(StrEnum):
    """Who initiated the action: the platform itself, or the user (e.g. a consented job)."""

    SYSTEM = "system"
    USER = "user"


class NewActivity(BaseModel):
    """An entry to record. Produced by backend services, never accepted from clients."""

    model_config = ConfigDict(frozen=True)

    level: ActivityLevel
    category: ActivityCategory
    message: str = Field(min_length=1, max_length=500)
    detail: str | None = Field(default=None, max_length=2_000)
    actor: ActivityActor = ActivityActor.SYSTEM
    context: dict[str, Any] | None = None

    @field_validator("message", "detail")
    @classmethod
    def _strip(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("must not be blank")
        return stripped

    @field_validator("context")
    @classmethod
    def _bounded_json(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        if value is None:
            return None
        encoded = json.dumps(value, default=str)
        if len(encoded.encode()) > MAX_CONTEXT_BYTES:
            raise ValueError(f"context must serialise to at most {MAX_CONTEXT_BYTES} bytes")
        decoded: dict[str, Any] = json.loads(encoded)
        return decoded


class ActivityEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ts: datetime
    level: ActivityLevel
    category: ActivityCategory
    actor: ActivityActor
    message: str
    detail: str | None
    context: dict[str, Any] | None


class ActivityPage(BaseModel):
    items: list[ActivityEntry]
    # Pass as `before_id` to fetch the next (older) page; null when exhausted.
    next_before_id: int | None
