"""Data access for the activity log. Knows SQL; knows nothing about HTTP."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import ActivityRecord
from .schemas import ActivityCategory, ActivityLevel, NewActivity


class ActivityRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def add(self, entry: NewActivity, ts: datetime) -> ActivityRecord:
        record = ActivityRecord(
            ts=ts,
            level=entry.level,
            category=entry.category,
            actor=entry.actor,
            message=entry.message,
            detail=entry.detail,
            context=entry.context,
        )
        self.session.add(record)
        await self.session.flush()
        return record

    async def newest(
        self,
        *,
        limit: int,
        before_id: int | None = None,
        level: ActivityLevel | None = None,
        category: ActivityCategory | None = None,
    ) -> list[ActivityRecord]:
        """Newest first, keyset-paginated by id (stable under concurrent inserts)."""
        query = select(ActivityRecord).order_by(ActivityRecord.id.desc()).limit(limit)
        if before_id is not None:
            query = query.where(ActivityRecord.id < before_id)
        if level is not None:
            query = query.where(ActivityRecord.level == level)
        if category is not None:
            query = query.where(ActivityRecord.category == category)
        return list((await self.session.scalars(query)).all())

    async def count(self) -> int:
        return int(await self.session.scalar(select(func.count()).select_from(ActivityRecord)) or 0)

    async def delete_older_than(self, cutoff: datetime) -> int:
        result = await self.session.execute(
            delete(ActivityRecord).where(ActivityRecord.ts < cutoff)
        )
        return int(getattr(result, "rowcount", 0) or 0)

    async def trim_to(self, max_entries: int) -> int:
        """Keep only the newest `max_entries` rows."""
        boundary = await self.session.scalar(
            select(ActivityRecord.id)
            .order_by(ActivityRecord.id.desc())
            .offset(max_entries)
            .limit(1)
        )
        if boundary is None:
            return 0
        result = await self.session.execute(
            delete(ActivityRecord).where(ActivityRecord.id <= boundary)
        )
        return int(getattr(result, "rowcount", 0) or 0)
