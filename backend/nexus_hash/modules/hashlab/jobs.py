"""HashLab job manager: admission control, isolated execution, progress, audit.

Safety model (ADR 0002):

* One job at a time, in one worker process that runs at reduced priority.
* Hard, server-side limits on difficulty and wall-clock time.
* Any job allowed to run longer than the consent threshold, and every
  benchmark, requires explicit consent on that request.
* Work runs in short chunks; between chunks the server checks for
  cancellation and the deadline, so a job can always be stopped within
  about a quarter of a second.
* Every run is persisted and written to the activity log as user-initiated.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import multiprocessing
import time
import uuid
from collections.abc import Callable
from concurrent.futures import Executor, ProcessPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from nexus_hash.core.config import Settings
from nexus_hash.core.errors import (
    ConflictError,
    NotFoundError,
    PermissionRequiredError,
    ResourceLimitError,
)
from nexus_hash.core.realtime import RealtimeHub, Topic
from nexus_hash.modules.activity.schemas import (
    ActivityActor,
    ActivityCategory,
    ActivityLevel,
    NewActivity,
)
from nexus_hash.modules.activity.service import ActivityService

from .models import SimulationRun
from .pow import (
    GENESIS_BLOCK,
    NONCE_SPACE,
    BlockHeader,
    display_hex,
    leading_zero_bits,
    target_for_zero_bits,
)
from .repository import SimulationRunRepository
from .schemas import HeaderInput, JobKind, JobRequest, JobStatus, JobView
from .worker import ChunkResult, lower_priority, search_nonces

logger = logging.getLogger("nexus_hash.hashlab")

TARGET_CHUNK_SECONDS = 0.25
INITIAL_CHUNK = 50_000
MAX_CHUNK = 4_000_000
CANCEL_WAIT_SECONDS = 5.0
INTERRUPTED_ERROR = "Interrupted: the server stopped while this run was active."

ExecutorFactory = Callable[[], Executor]


def process_executor() -> Executor:
    """One spawned, low-priority worker process (spawn is safe with asyncio and threads)."""
    return ProcessPoolExecutor(
        max_workers=1,
        mp_context=multiprocessing.get_context("spawn"),
        initializer=lower_priority,
    )


def format_rate(hashes_per_second: float | None) -> str:
    if not hashes_per_second:
        return "n/a"
    for unit, scale in (("TH/s", 1e12), ("GH/s", 1e9), ("MH/s", 1e6), ("kH/s", 1e3)):
        if hashes_per_second >= scale:
            return f"{hashes_per_second / scale:.2f} {unit}"
    return f"{hashes_per_second:.0f} H/s"


def _runs_were(count: int) -> str:
    return "run was" if count == 1 else "runs were"


def _utcnow() -> datetime:
    return datetime.now(UTC)


@dataclass
class _Job:
    id: str
    kind: JobKind
    difficulty_bits: int
    max_seconds: float
    consent: bool
    header: BlockHeader
    start_nonce: int
    created_at: datetime
    status: JobStatus = JobStatus.QUEUED
    attempts: int = 0
    compute_seconds: float = 0.0
    elapsed_seconds: float = 0.0
    best_value: int | None = None
    found_nonce: int | None = None
    found_value: int | None = None
    error: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    cancel_requested: asyncio.Event = field(default_factory=asyncio.Event)

    @property
    def hash_rate(self) -> float | None:
        return self.attempts / self.compute_seconds if self.compute_seconds > 0 else None

    def view(self) -> JobView:
        return JobView(
            id=self.id,
            kind=self.kind,
            status=self.status,
            difficulty_bits=self.difficulty_bits,
            expected_attempts=float(2**self.difficulty_bits) if self.kind is JobKind.MINE else 0.0,
            max_seconds=self.max_seconds,
            consent=self.consent,
            attempts=self.attempts,
            elapsed_seconds=round(self.elapsed_seconds, 3),
            hash_rate_hs=self.hash_rate,
            best_hash=_hex(self.best_value),
            best_zero_bits=None if self.best_value is None else leading_zero_bits(self.best_value),
            found_nonce=self.found_nonce,
            found_hash=_hex(self.found_value),
            error=self.error,
            created_at=self.created_at,
            started_at=self.started_at,
            finished_at=self.finished_at,
        )


def _hex(value: int | None) -> str | None:
    return None if value is None else display_hex(value.to_bytes(32, "little"))


def _view_from_run(run: SimulationRun) -> JobView:
    return JobView(
        id=run.id,
        kind=run.kind,
        status=run.status,
        difficulty_bits=run.difficulty_bits,
        expected_attempts=float(2**run.difficulty_bits) if run.kind is JobKind.MINE else 0.0,
        max_seconds=run.max_seconds,
        consent=run.consent,
        attempts=run.attempts,
        elapsed_seconds=run.elapsed_seconds,
        hash_rate_hs=run.hash_rate_hs,
        best_hash=run.best_hash,
        best_zero_bits=run.best_zero_bits,
        found_nonce=run.found_nonce,
        found_hash=run.found_hash,
        error=run.error,
        created_at=run.created_at,
        started_at=run.started_at,
        finished_at=run.finished_at,
    )


class HashLabJobs:
    def __init__(
        self,
        sessions: async_sessionmaker[AsyncSession],
        hub: RealtimeHub,
        activity: ActivityService,
        settings: Settings,
        executor_factory: ExecutorFactory = process_executor,
    ) -> None:
        self._sessions = sessions
        self._hub = hub
        self._activity = activity
        self._settings = settings
        self._executor_factory = executor_factory
        self._executor: Executor | None = None
        self._current: _Job | None = None
        self._task: asyncio.Task[None] | None = None
        hub.set_snapshot_provider(Topic.HASHLAB, self._snapshot)

    # --- Lifecycle ------------------------------------------------------------------

    async def recover_interrupted(self) -> int:
        """Mark runs a previous process left unfinished; called once at startup."""
        async with self._sessions() as session, session.begin():
            count = await SimulationRunRepository(session).fail_unfinished(
                error=INTERRUPTED_ERROR, finished_at=_utcnow()
            )
        if count:
            await self._activity.record(
                NewActivity(
                    level=ActivityLevel.WARNING,
                    category=ActivityCategory.HASHLAB,
                    message=f"{count} simulation {_runs_were(count)} interrupted by a restart",
                    detail="Marked as failed. No work continues in the background.",
                )
            )
        return count

    async def shutdown(self) -> None:
        if self._current is not None:
            self._current.cancel_requested.set()
        if self._task is not None:
            with contextlib.suppress(asyncio.TimeoutError, asyncio.CancelledError):
                await asyncio.wait_for(asyncio.shield(self._task), CANCEL_WAIT_SECONDS)
        if self._executor is not None:
            executor, self._executor = self._executor, None
            await asyncio.to_thread(executor.shutdown, True, cancel_futures=True)

    # --- Queries ----------------------------------------------------------------------

    def current(self) -> JobView | None:
        return self._current.view() if self._current else None

    async def get(self, job_id: str) -> JobView:
        if self._current and self._current.id == job_id:
            return self._current.view()
        async with self._sessions() as session:
            run = await SimulationRunRepository(session).get(job_id)
        if run is None:
            raise NotFoundError(f"No simulation run {job_id!r}.")
        return _view_from_run(run)

    async def recent(self, limit: int) -> list[JobView]:
        async with self._sessions() as session:
            runs = await SimulationRunRepository(session).recent(limit)
        views = [_view_from_run(run) for run in runs]
        if self._current:  # the live view is fresher than the persisted row
            views = [
                self._current.view() if view.id == self._current.id else view for view in views
            ]
        return views

    # --- Commands ---------------------------------------------------------------------

    def admission_check(self, request: JobRequest) -> None:
        """Raise if the request breaks a limit, lacks consent, or the lab is busy."""
        settings = self._settings
        if (
            request.kind is JobKind.MINE
            and request.difficulty_bits > settings.hashlab_max_difficulty_bits
        ):
            raise ResourceLimitError(
                f"Difficulty is limited to {settings.hashlab_max_difficulty_bits} bits.",
                details=[{"field": "difficulty_bits", "max": settings.hashlab_max_difficulty_bits}],
            )
        if request.max_seconds > settings.hashlab_max_job_seconds:
            raise ResourceLimitError(
                f"Runs are limited to {settings.hashlab_max_job_seconds:g} seconds.",
                details=[{"field": "max_seconds", "max": settings.hashlab_max_job_seconds}],
            )
        threshold = settings.hashlab_consent_threshold_seconds
        if not request.consent:
            if request.kind is JobKind.BENCHMARK:
                reason = "A benchmark deliberately keeps one CPU core fully busy."
            elif request.max_seconds > threshold:
                reason = f"This run may keep one CPU core busy for more than {threshold:g} seconds."
            else:
                reason = None
            if reason:
                raise PermissionRequiredError(
                    f"{reason} Confirm to continue.",
                    details=[
                        {
                            "reason": "intensive_workload",
                            "max_seconds": request.max_seconds,
                            "threshold_seconds": threshold,
                            "cpu_cores": 1,
                        }
                    ],
                )
        if self._current is not None:
            raise ConflictError(
                "A HashLab run is already in progress. Wait for it or cancel it first.",
                details=[{"job_id": self._current.id}],
            )

    async def start(self, request: JobRequest) -> JobView:
        self.admission_check(request)
        header = request.header.to_header() if request.header else GENESIS_BLOCK
        job = _Job(
            id=uuid.uuid4().hex,
            kind=request.kind,
            difficulty_bits=request.difficulty_bits,
            max_seconds=request.max_seconds,
            consent=request.consent,
            header=header,
            start_nonce=request.start_nonce,
            created_at=_utcnow(),
        )
        self._current = job  # claim the slot before any await
        try:
            async with self._sessions() as session, session.begin():
                await SimulationRunRepository(session).add(
                    SimulationRun(
                        id=job.id,
                        kind=job.kind,
                        status=job.status,
                        difficulty_bits=job.difficulty_bits,
                        max_seconds=job.max_seconds,
                        consent=job.consent,
                        header=HeaderInput.from_header(header).model_dump(),
                        start_nonce=job.start_nonce,
                        created_at=job.created_at,
                    )
                )
            await self._activity.record(self._start_entry(job))
        except Exception:
            self._current = None
            raise
        self._task = asyncio.create_task(self._run(job), name=f"hashlab-{job.id}")
        return job.view()

    async def cancel(self, job_id: str) -> JobView:
        job = self._current
        if job is None or job.id != job_id:
            view = await self.get(job_id)  # 404 if unknown
            if view.status.finished:
                return view
            raise ConflictError("That run is not active in this server process.")
        job.cancel_requested.set()
        if self._task is not None:
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(asyncio.shield(self._task), CANCEL_WAIT_SECONDS)
        return job.view()

    # --- Execution ----------------------------------------------------------------------

    def _executor_instance(self) -> Executor:
        if self._executor is None:
            self._executor = self._executor_factory()
        return self._executor

    async def _run(self, job: _Job) -> None:
        job.status = JobStatus.RUNNING
        job.started_at = _utcnow()
        started = time.monotonic()
        await self._persist(job)
        self._publish(job)
        try:
            job.status = await self._search(job, started)
        except Exception as exc:
            logger.exception("HashLab run %s failed", job.id)
            job.status = JobStatus.FAILED
            job.error = f"The simulation worker failed: {type(exc).__name__}."
        finally:
            job.elapsed_seconds = time.monotonic() - started
            job.finished_at = _utcnow()
            self._current = None
            self._publish(job)
            try:
                await self._persist(job)
                await self._activity.record(self._finish_entry(job))
            except Exception:
                logger.exception("could not persist the outcome of HashLab run %s", job.id)

    async def _search(self, job: _Job, started: float) -> JobStatus:
        """Run chunks until a stop condition holds; return the final status."""
        loop = asyncio.get_running_loop()
        prefix = job.header.prefix()
        benchmark = job.kind is JobKind.BENCHMARK
        target = 0 if benchmark else target_for_zero_bits(job.difficulty_bits)
        next_nonce = job.start_nonce
        chunk = INITIAL_CHUNK

        while True:
            if job.cancel_requested.is_set():
                return JobStatus.CANCELLED
            remaining = job.max_seconds - (time.monotonic() - started)
            if remaining <= 0:
                return JobStatus.SUCCEEDED if benchmark else JobStatus.TIMED_OUT
            if next_nonce >= NONCE_SPACE:
                if not benchmark:
                    return JobStatus.EXHAUSTED
                next_nonce = 0  # a benchmark only measures speed, so it wraps around

            result: ChunkResult = await loop.run_in_executor(
                self._executor_instance(),
                search_nonces,
                prefix,
                next_nonce,
                min(chunk, NONCE_SPACE - next_nonce),
                target,
                min(TARGET_CHUNK_SECONDS, remaining),
            )
            self._absorb(job, result, started)
            next_nonce += result.attempts
            if result.found_nonce is not None:
                job.found_nonce = result.found_nonce
                job.found_value = result.best_value
                return JobStatus.SUCCEEDED
            if result.elapsed > 0:  # size the next chunk to take about TARGET_CHUNK_SECONDS
                rate = result.attempts / result.elapsed
                chunk = max(1_000, min(MAX_CHUNK, int(rate * TARGET_CHUNK_SECONDS)))
            self._publish(job)

    @staticmethod
    def _absorb(job: _Job, result: ChunkResult, started: float) -> None:
        job.attempts += result.attempts
        job.compute_seconds += result.elapsed
        job.elapsed_seconds = time.monotonic() - started
        if result.attempts and (job.best_value is None or result.best_value < job.best_value):
            job.best_value = result.best_value

    async def _persist(self, job: _Job) -> None:
        async with self._sessions() as session, session.begin():
            run = await SimulationRunRepository(session).get(job.id)
            if run is None:  # pragma: no cover - created in start()
                return
            run.status = job.status
            run.attempts = job.attempts
            run.elapsed_seconds = round(job.elapsed_seconds, 3)
            run.hash_rate_hs = job.hash_rate
            run.best_hash = _hex(job.best_value)
            run.best_zero_bits = (
                None if job.best_value is None else leading_zero_bits(job.best_value)
            )
            run.found_nonce = job.found_nonce
            run.found_hash = _hex(job.found_value)
            run.error = job.error
            run.started_at = job.started_at
            run.finished_at = job.finished_at

    def _publish(self, job: _Job) -> None:
        self._hub.publish(Topic.HASHLAB, "job.update", {"job": job.view().model_dump(mode="json")})

    def _snapshot(self) -> tuple[str, dict[str, Any]]:
        view = self.current()
        return "job.update", {"job": view.model_dump(mode="json") if view else None}

    # --- Activity log --------------------------------------------------------------------

    @staticmethod
    def _start_entry(job: _Job) -> NewActivity:
        if job.kind is JobKind.BENCHMARK:
            message = f"Hash-rate benchmark started (up to {job.max_seconds:g} s)"
        else:
            message = (
                f"Mining simulation started: {job.difficulty_bits}-bit difficulty, "
                f"up to {job.max_seconds:g} s"
            )
        detail = (
            f"Explicit consent given to use one CPU core for up to {job.max_seconds:g} s."
            if job.consent
            else "Short run below the consent threshold."
        )
        return NewActivity(
            level=ActivityLevel.INFO,
            category=ActivityCategory.HASHLAB,
            actor=ActivityActor.USER,
            message=message,
            detail=detail,
            context={"job_id": job.id, "kind": job.kind.value, "consent": job.consent},
        )

    @staticmethod
    def _finish_entry(job: _Job) -> NewActivity:
        attempts = f"{job.attempts:,} attempts"
        took = f"{job.elapsed_seconds:.1f} s, {format_rate(job.hash_rate)}"
        level = ActivityLevel.INFO
        if job.status is JobStatus.SUCCEEDED and job.kind is JobKind.BENCHMARK:
            level = ActivityLevel.SUCCESS
            message = (
                f"Benchmark complete: {format_rate(job.hash_rate)} over {job.elapsed_seconds:.1f} s"
            )
        elif job.status is JobStatus.SUCCEEDED:
            level = ActivityLevel.SUCCESS
            message = f"Simulated block found: nonce {job.found_nonce} after {attempts} ({took})"
        elif job.status is JobStatus.TIMED_OUT:
            message = f"Mining simulation reached its {job.max_seconds:g} s limit after {attempts}"
        elif job.status is JobStatus.EXHAUSTED:
            message = f"Mining simulation exhausted the nonce range after {attempts}"
        elif job.status is JobStatus.CANCELLED:
            message = f"HashLab run cancelled after {attempts}"
        else:
            level = ActivityLevel.ERROR
            message = "HashLab run failed"
        return NewActivity(
            level=level,
            category=ActivityCategory.HASHLAB,
            actor=ActivityActor.USER,
            message=message,
            detail=job.error
            or "Simulated work only; nothing was submitted to the Bitcoin network.",
            context={"job_id": job.id, "status": job.status.value, "attempts": job.attempts},
        )
