"""Hardware Intelligence API (read-only)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from nexus_hash.core.errors import AppError, ErrorCode

from .schemas import HardwareHistory, HardwareSpecs, LiveSamples
from .service import HardwareMonitor

router = APIRouter(prefix="/hardware", tags=["hardware"])


class MonitoringDisabledError(AppError):
    status_code = 503
    code = ErrorCode.SERVICE_UNAVAILABLE


def get_monitor(request: Request) -> HardwareMonitor:
    monitor: HardwareMonitor | None = getattr(request.app.state, "hardware", None)
    if monitor is None:
        raise MonitoringDisabledError(
            "Hardware monitoring is turned off (NEXUS_HARDWARE_MONITORING_ENABLED=false)."
        )
    return monitor


MonitorDep = Annotated[HardwareMonitor, Depends(get_monitor)]


@router.get(
    "/specs", response_model=HardwareSpecs, summary="Machine specification and what can be measured"
)
async def specs(monitor: MonitorDep) -> HardwareSpecs:
    return await monitor.specs()


@router.get("/live", response_model=LiveSamples, summary="Samples from the last 10 minutes")
async def live(monitor: MonitorDep) -> LiveSamples:
    return monitor.live()


@router.get("/history", response_model=HardwareHistory, summary="Aggregated history")
async def history(
    monitor: MonitorDep,
    hours: Annotated[float, Query(gt=0, le=24 * 365)] = 24,
) -> HardwareHistory:
    return await monitor.history(hours)
