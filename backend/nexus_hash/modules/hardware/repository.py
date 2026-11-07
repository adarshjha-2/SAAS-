"""Data access for aggregated hardware history."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import HardwareSampleRow


class HardwareRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def add(self, row: HardwareSampleRow) -> None:
        self.session.add(row)
        await self.session.flush()

    async def since(self, start: datetime, limit: int) -> list[HardwareSampleRow]:
        query = (
            select(HardwareSampleRow)
            .where(HardwareSampleRow.ts >= start)
            .order_by(HardwareSampleRow.ts.asc())
            .limit(limit)
        )
        return list((await self.session.scalars(query)).all())

    async def delete_older_than(self, cutoff: datetime) -> int:
        result = await self.session.execute(
            delete(HardwareSampleRow).where(HardwareSampleRow.ts < cutoff)
        )
        return int(getattr(result, "rowcount", 0) or 0)
