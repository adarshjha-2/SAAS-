"""The hardware monitor: samples, streams, aggregates and persists.

Sampling happens in a worker thread (sensor reads touch the filesystem) so
the event loop never blocks. The last 10 minutes stay in memory for live
charts; longer history is stored as one aggregated row per window.
"""

from __future__ import annotations

import asyncio
import logging
import statistics
import time
from collections import deque
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from nexus_hash.core.config import Settings
from nexus_hash.core.realtime import RealtimeHub, Topic
from nexus_hash.modules.activity.schemas import ActivityCategory, ActivityLevel, NewActivity
from nexus_hash.modules.activity.service import ActivityService

from .models import HardwareSampleRow
from .probe import Probe
from .repository import HardwareRepository
from .schemas import HardwareHistory, HardwareSample, HardwareSpecs, HistoryPoint, LiveSamples

logger = logging.getLogger("nexus_hash.hardware")

LIVE_WINDOW_SECONDS = 600
MAX_HISTORY_POINTS = 20_000


def _mean(values: list[float]) -> float | None:
    return round(statistics.fmean(values), 2) if values else None


def aggregate(samples: list[HardwareSample], window_seconds: float) -> HardwareSampleRow:
    """Summarise a window of samples into one history row (unsupported metrics stay null)."""
    if not samples:
        raise ValueError("cannot aggregate an empty window")
    cpu = [sample.cpu_percent for sample in samples]
    temperatures = [reading.celsius for sample in samples for reading in sample.temperatures or []]
    power = [sample.power_w for sample in samples if sample.power_w is not None]
    loads = [sample.load_average[0] for sample in samples if sample.load_average is not None]
    gpu = [
        gpu.utilization_percent
        for sample in samples
        for gpu in sample.gpus or []
        if gpu.utilization_percent is not None
    ]
    return HardwareSampleRow(
        ts=samples[-1].ts,
        window_seconds=window_seconds,
        samples=len(samples),
        cpu_avg=round(statistics.fmean(cpu), 2),
        cpu_max=max(cpu),
        memory_percent_avg=round(statistics.fmean(sample.memory.percent for sample in samples), 2),
        load1_avg=_mean(loads),
        temperature_max_c=max(temperatures) if temperatures else None,
        power_avg_w=_mean(power),
        gpu_utilization_avg=_mean(gpu),
    )


def capability_summary(specs: HardwareSpecs) -> tuple[str, str]:
    available = [cap.label for cap in specs.capabilities if cap.supported]
    missing = [
        f"{cap.label} ({(cap.reason or '').rstrip('.')})"
        for cap in specs.capabilities
        if not cap.supported
    ]
    detail = f"Available: {', '.join(available)}."
    if missing:
        detail += f" Not available here: {'; '.join(missing)}."
    return "Hardware monitoring started", detail[:2_000]


class HardwareMonitor:
    def __init__(
        self,
        probe: Probe,
        hub: RealtimeHub,
        sessions: async_sessionmaker[AsyncSession],
        activity: ActivityService,
        settings: Settings,
        *,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._probe = probe
        self._hub = hub
        self._sessions = sessions
        self._activity = activity
        self._settings = settings
        self._clock = clock
        self._interval = settings.hardware_sample_seconds
        self._ring: deque[HardwareSample] = deque(
            maxlen=max(1, int(LIVE_WINDOW_SECONDS / self._interval))
        )
        self._pending: list[HardwareSample] = []
        self._window_started = clock()
        self._specs: HardwareSpecs | None = None
        hub.set_snapshot_provider(Topic.HARDWARE, self._snapshot)

    # --- Queries -------------------------------------------------------------------------

    async def specs(self) -> HardwareSpecs:
        if self._specs is None:
            self._specs = await asyncio.to_thread(self._probe.specs)
        return self._specs

    def live(self) -> LiveSamples:
        return LiveSamples(interval_seconds=self._interval, samples=list(self._ring))

    async def history(self, hours: float) -> HardwareHistory:
        start = datetime.now(UTC) - timedelta(hours=hours)
        async with self._sessions() as session:
            rows = await HardwareRepository(session).since(start, MAX_HISTORY_POINTS)
        return HardwareHistory(
            hours=hours,
            points=[
                HistoryPoint(
                    ts=row.ts,
                    window_seconds=row.window_seconds,
                    samples=row.samples,
                    cpu_avg=row.cpu_avg,
                    cpu_max=row.cpu_max,
                    memory_percent_avg=row.memory_percent_avg,
                    load1_avg=row.load1_avg,
                    temperature_max_c=row.temperature_max_c,
                    power_avg_w=row.power_avg_w,
                    gpu_utilization_avg=row.gpu_utilization_avg,
                )
                for row in rows
            ],
        )

    # --- Lifecycle -------------------------------------------------------------------------

    async def announce(self) -> None:
        """Record, once per start, what this machine lets us measure and why not the rest."""
        message, detail = capability_summary(await self.specs())
        await self._activity.record(
            NewActivity(
                level=ActivityLevel.INFO,
                category=ActivityCategory.HARDWARE,
                message=message,
                detail=detail,
            )
        )

    async def sample_once(self) -> HardwareSample:
        sample = await asyncio.to_thread(self._probe.sample)
        self._ring.append(sample)
        self._pending.append(sample)
        self._hub.publish(Topic.HARDWARE, "sample", {"sample": sample.model_dump(mode="json")})
        if self._clock() - self._window_started >= self._settings.hardware_persist_seconds:
            await self.flush()
        return sample

    async def flush(self) -> None:
        """Persist the pending window as one aggregated row and apply retention."""
        window = self._clock() - self._window_started
        pending, self._pending = self._pending, []
        self._window_started = self._clock()
        if not pending:
            return
        cutoff = datetime.now(UTC) - timedelta(days=self._settings.hardware_retention_days)
        async with self._sessions() as session, session.begin():
            repository = HardwareRepository(session)
            await repository.add(aggregate(pending, round(window, 2)))
            await repository.delete_older_than(cutoff)

    async def run(self) -> None:
        """Background loop until cancelled. A failed sample is logged and skipped."""
        failures = 0
        while True:
            started = self._clock()
            try:
                await self.sample_once()
                failures = 0
            except asyncio.CancelledError:
                raise
            except Exception:
                failures += 1
                if failures == 1 or failures % 100 == 0:
                    logger.exception("hardware sample failed (%d in a row)", failures)
            await asyncio.sleep(max(0.0, self._interval - (self._clock() - started)))

    def _snapshot(self) -> tuple[str, dict[str, Any]]:
        latest = self._ring[-1] if self._ring else None
        return "sample", {"sample": latest.model_dump(mode="json") if latest else None}
