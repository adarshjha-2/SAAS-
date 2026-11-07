"""Data access for simulation runs."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .models import SimulationRun
from .schemas import JobStatus


class SimulationRunRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def add(self, run: SimulationRun) -> None:
        self.session.add(run)
        await self.session.flush()

    async def get(self, run_id: str) -> SimulationRun | None:
        return await self.session.get(SimulationRun, run_id)

    async def recent(self, limit: int) -> list[SimulationRun]:
        query = select(SimulationRun).order_by(SimulationRun.created_at.desc()).limit(limit)
        return list((await self.session.scalars(query)).all())

    async def fail_unfinished(self, *, error: str, finished_at: datetime) -> int:
        """Mark runs left queued/running by a crash or restart as failed."""
        result = await self.session.execute(
            update(SimulationRun)
            .where(SimulationRun.status.in_([JobStatus.QUEUED, JobStatus.RUNNING]))
            .values(status=JobStatus.FAILED, error=error, finished_at=finished_at)
        )
        return int(getattr(result, "rowcount", 0) or 0)
