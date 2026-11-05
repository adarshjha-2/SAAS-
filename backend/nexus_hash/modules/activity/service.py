"""Activity log service: persists entries and pushes them to live dashboards."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from nexus_hash.core.realtime import RealtimeHub, Topic

from .repository import ActivityRepository
from .schemas import (
    ActivityCategory,
    ActivityEntry,
    ActivityLevel,
    ActivityPage,
    NewActivity,
)

logger = logging.getLogger("nexus_hash.activity")

Clock = Callable[[], datetime]


def _utcnow() -> datetime:
    return datetime.now(UTC)


class ActivityService:
    def __init__(
        self,
        sessions: async_sessionmaker[AsyncSession],
        hub: RealtimeHub,
        clock: Clock = _utcnow,
    ) -> None:
        self._sessions = sessions
        self._hub = hub
        self._clock = clock

    async def record(self, entry: NewActivity) -> ActivityEntry:
        """Persist an entry, then publish it on the `activity` topic."""
        async with self._sessions() as session, session.begin():
            record = await ActivityRepository(session).add(entry, self._clock())
            saved = ActivityEntry.model_validate(record)
        self._hub.publish(Topic.ACTIVITY, "entry", saved.model_dump(mode="json"))
        return saved

    async def page(
        self,
        *,
        limit: int,
        before_id: int | None = None,
        level: ActivityLevel | None = None,
        category: ActivityCategory | None = None,
    ) -> ActivityPage:
        async with self._sessions() as session:
            records = await ActivityRepository(session).newest(
                limit=limit + 1, before_id=before_id, level=level, category=category
            )
        has_more = len(records) > limit
        items = [ActivityEntry.model_validate(record) for record in records[:limit]]
        return ActivityPage(
            items=items, next_before_id=items[-1].id if has_more and items else None
        )

    async def apply_retention(self, *, max_age_days: int, max_entries: int) -> int:
        """Delete entries older than the age limit, then beyond the count cap."""
        cutoff = self._clock() - timedelta(days=max_age_days)
        async with self._sessions() as session, session.begin():
            repository = ActivityRepository(session)
            removed = await repository.delete_older_than(cutoff)
            removed += await repository.trim_to(max_entries)
        return removed


def _plural(count: int) -> str:
    return "entry" if count == 1 else "entries"


async def run_retention(
    service: ActivityService,
    *,
    interval: float,
    max_age_days: int,
    max_entries: int,
) -> None:
    """Background job: apply retention on start and then every `interval` seconds."""
    while True:
        try:
            removed = await service.apply_retention(
                max_age_days=max_age_days, max_entries=max_entries
            )
            if removed:
                await service.record(
                    NewActivity(
                        level=ActivityLevel.INFO,
                        category=ActivityCategory.DATABASE,
                        message=f"Retention removed {removed} activity {_plural(removed)}",
                        detail=f"Policy: keep {max_age_days} days, at most {max_entries} entries.",
                        context={"removed": removed},
                    )
                )
        except asyncio.CancelledError:
            raise
        except Exception:
            # Retention failing must never take the server down; it retries next cycle.
            logger.exception("activity retention failed")
        await asyncio.sleep(interval)
