"""Read-only activity log API. Entries are written by backend services only."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from .schemas import ActivityCategory, ActivityLevel, ActivityPage
from .service import ActivityService

router = APIRouter(prefix="/activity", tags=["activity"])


def get_activity_service(request: Request) -> ActivityService:
    service: ActivityService = request.app.state.activity
    return service


ServiceDep = Annotated[ActivityService, Depends(get_activity_service)]


@router.get("", response_model=ActivityPage, summary="Activity log, newest first")
async def list_activity(
    service: ServiceDep,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    before_id: Annotated[
        int | None, Query(ge=1, description="Return entries older than this id")
    ] = None,
    level: ActivityLevel | None = None,
    category: ActivityCategory | None = None,
) -> ActivityPage:
    return await service.page(limit=limit, before_id=before_id, level=level, category=category)
