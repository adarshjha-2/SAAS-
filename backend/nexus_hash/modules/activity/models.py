"""ORM model for the activity log."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Enum, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from nexus_hash.db.base import Base, UTCDateTime

from .schemas import ActivityActor, ActivityCategory, ActivityLevel


def _enum(enum_type: type[ActivityLevel | ActivityCategory | ActivityActor], name: str) -> Enum:
    # Stored as plain strings with a CHECK constraint (portable, readable in sqlite3).
    return Enum(
        enum_type,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=16,
        values_callable=lambda members: [member.value for member in members],
        validate_strings=True,
    )


class ActivityRecord(Base):
    __tablename__ = "activity_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    level: Mapped[ActivityLevel] = mapped_column(
        _enum(ActivityLevel, "activity_level"), nullable=False
    )
    category: Mapped[ActivityCategory] = mapped_column(
        _enum(ActivityCategory, "activity_category"), nullable=False
    )
    actor: Mapped[ActivityActor] = mapped_column(
        _enum(ActivityActor, "activity_actor"), nullable=False
    )
    message: Mapped[str] = mapped_column(String(500), nullable=False)
    detail: Mapped[str | None] = mapped_column(String(2_000), nullable=True)
    context: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    __table_args__ = (
        Index("ix_activity_log_ts", "ts"),
        Index("ix_activity_log_category_id", "category", "id"),
        Index("ix_activity_log_level_id", "level", "id"),
    )
