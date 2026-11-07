"""Platform endpoints: health, build/runtime info and the module catalog."""

from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel

from nexus_hash import API_VERSION, APP_NAME, TAGLINE, __version__
from nexus_hash.api.deps import HubDep, SettingsDep
from nexus_hash.core.catalog import MODULES, ModuleDescriptor
from nexus_hash.core.catalog import get_module as find_module
from nexus_hash.core.config import Environment
from nexus_hash.core.errors import ErrorResponse, NotFoundError
from nexus_hash.core.realtime import Topic
from nexus_hash.db.engine import check_database

router = APIRouter(prefix="/system", tags=["system"])

CheckStatus = Literal["ok", "degraded", "down"]

DISCLAIMERS: tuple[str, ...] = (
    "HashLab is an educational simulator. Simulated hashes are never submitted to the "
    "Bitcoin network and cannot earn bitcoin.",
    "Profitability figures are estimates based on stated assumptions and live data that "
    "changes constantly. They are not a guarantee of earnings.",
    "NEXUS HASH AI never starts an intensive workload, spends money, or uses cloud "
    "computing without your explicit permission.",
)


class HealthResponse(BaseModel):
    status: CheckStatus
    version: str
    environment: Environment
    uptime_seconds: float
    server_time: datetime
    checks: dict[str, CheckStatus]


class FeatureFlags(BaseModel):
    llm_configured: bool
    docs_enabled: bool


class Limits(BaseModel):
    max_request_body_bytes: int
    ws_max_connections: int
    ws_max_message_bytes: int


class RealtimeInfo(BaseModel):
    path: str
    topics: list[Topic]
    heartbeat_seconds: float
    connections: int


class DatabaseInfo(BaseModel):
    schema_revision: str | None
    activity_retention_days: int
    activity_max_entries: int


class SystemInfo(BaseModel):
    name: str
    tagline: str
    version: str
    api_version: str
    environment: Environment
    features: FeatureFlags
    limits: Limits
    realtime: RealtimeInfo
    database: DatabaseInfo
    disclaimers: list[str]


def _uptime(request: Request) -> float:
    started: float = request.app.state.started_at
    return round(time.monotonic() - started, 3)


def _realtime_check(request: Request) -> CheckStatus:
    task = request.app.state.background_tasks.get("system_heartbeat")
    if task is None or task.done():
        return "degraded"
    return "ok"


@router.get("/health", response_model=HealthResponse, summary="Liveness and readiness")
async def health(request: Request, settings: SettingsDep) -> HealthResponse:
    database_ok = await check_database(getattr(request.app.state, "db_engine", None))
    checks: dict[str, CheckStatus] = {
        "api": "ok",
        "realtime": _realtime_check(request),
        "database": "ok" if database_ok else "down",
    }
    overall: CheckStatus = "ok" if all(value == "ok" for value in checks.values()) else "degraded"
    return HealthResponse(
        status=overall,
        version=__version__,
        environment=settings.environment,
        uptime_seconds=_uptime(request),
        server_time=datetime.now(UTC),
        checks=checks,
    )


@router.get("/info", response_model=SystemInfo, summary="Build, feature and limit information")
async def info(request: Request, settings: SettingsDep, hub: HubDep) -> SystemInfo:
    return SystemInfo(
        name=APP_NAME,
        tagline=TAGLINE,
        version=__version__,
        api_version=API_VERSION,
        environment=settings.environment,
        # Only *whether* a key is configured is exposed - never the key itself.
        features=FeatureFlags(
            llm_configured=settings.llm_configured,
            docs_enabled=settings.api_docs_enabled,
        ),
        limits=Limits(
            max_request_body_bytes=settings.max_request_body_bytes,
            ws_max_connections=settings.ws_max_connections,
            ws_max_message_bytes=settings.ws_max_message_bytes,
        ),
        realtime=RealtimeInfo(
            path=f"/ws/{API_VERSION}",
            topics=list(Topic),
            heartbeat_seconds=settings.ws_heartbeat_seconds,
            connections=hub.connection_count,
        ),
        database=DatabaseInfo(
            schema_revision=getattr(request.app.state, "schema_revision", None),
            activity_retention_days=settings.activity_retention_days,
            activity_max_entries=settings.activity_max_entries,
        ),
        disclaimers=list(DISCLAIMERS),
    )


@router.get("/modules", response_model=list[ModuleDescriptor], summary="Product module catalog")
async def list_modules() -> list[ModuleDescriptor]:
    return list(MODULES)


@router.get(
    "/modules/{key}",
    response_model=ModuleDescriptor,
    responses={404: {"model": ErrorResponse}},
    summary="A single product module",
)
async def get_module(key: str) -> ModuleDescriptor:
    module = find_module(key)
    if module is None:
        raise NotFoundError(f"Unknown module {key!r}.")
    return module
