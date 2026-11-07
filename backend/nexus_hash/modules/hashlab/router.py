"""HashLab HTTP API. Instant demos are synchronous; mining runs are jobs."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Request, status

from nexus_hash.core.errors import ErrorResponse

from . import service
from .jobs import HashLabJobs
from .pow import NONCE_SPACE
from .schemas import (
    CompetitionRequest,
    CompetitionResponse,
    HashLabLimits,
    HashRequest,
    HashResponse,
    HeaderAnalysis,
    HeaderInput,
    HeaderPreset,
    JobRequest,
    JobView,
    NonceRequest,
    NonceResponse,
)

router = APIRouter(prefix="/hashlab", tags=["hashlab"])

JOB_ERRORS: dict[int | str, dict[str, object]] = {
    403: {"model": ErrorResponse, "description": "Explicit consent required"},
    409: {"model": ErrorResponse, "description": "Another run is in progress"},
    422: {"model": ErrorResponse, "description": "Invalid request or resource limit exceeded"},
}


def get_jobs(request: Request) -> HashLabJobs:
    jobs: HashLabJobs = request.app.state.hashlab
    return jobs


JobsDep = Annotated[HashLabJobs, Depends(get_jobs)]
JobId = Annotated[str, Path(pattern=r"^[0-9a-f]{32}$")]


@router.get("/limits", response_model=HashLabLimits, summary="Server-enforced limits")
async def limits(request: Request) -> HashLabLimits:
    settings = request.app.state.settings
    return HashLabLimits(
        max_difficulty_bits=settings.hashlab_max_difficulty_bits,
        max_job_seconds=settings.hashlab_max_job_seconds,
        consent_threshold_seconds=settings.hashlab_consent_threshold_seconds,
        nonce_space=NONCE_SPACE,
        worker_processes=1,
    )


@router.get("/presets", response_model=list[HeaderPreset], summary="Real Bitcoin block headers")
async def presets() -> list[HeaderPreset]:
    return list(service.PRESETS)


@router.post("/sha256", response_model=HashResponse, summary="SHA-256 with the avalanche effect")
async def sha256(body: HashRequest) -> HashResponse:
    return service.hash_payload(body.payload())


@router.post("/header", response_model=HeaderAnalysis, summary="Serialise and hash a block header")
async def header(body: HeaderInput) -> HeaderAnalysis:
    return service.analyze_header(body.to_header())


@router.post("/nonces", response_model=NonceResponse, summary="Try a small range of nonces")
async def nonces(body: NonceRequest) -> NonceResponse:
    return service.try_nonces(body)


@router.post(
    "/competition",
    response_model=CompetitionResponse,
    summary="Simulate miners competing (simulated time; negligible CPU)",
)
async def competition(body: CompetitionRequest) -> CompetitionResponse:
    return service.run_competition(body)


@router.post(
    "/jobs",
    response_model=JobView,
    status_code=status.HTTP_202_ACCEPTED,
    responses=JOB_ERRORS,
    summary="Start a mining simulation or hash-rate benchmark",
)
async def start_job(body: JobRequest, jobs: JobsDep) -> JobView:
    return await jobs.start(body)


@router.get("/jobs", response_model=list[JobView], summary="Recent simulation runs")
async def list_jobs(jobs: JobsDep, limit: Annotated[int, Query(ge=1, le=50)] = 10) -> list[JobView]:
    return await jobs.recent(limit)


@router.get("/jobs/{job_id}", response_model=JobView, responses={404: {"model": ErrorResponse}})
async def get_job(job_id: JobId, jobs: JobsDep) -> JobView:
    return await jobs.get(job_id)


@router.post(
    "/jobs/{job_id}/cancel",
    response_model=JobView,
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
    summary="Stop a run (takes effect within about 0.25 s)",
)
async def cancel_job(job_id: JobId, jobs: JobsDep) -> JobView:
    return await jobs.cancel(job_id)
