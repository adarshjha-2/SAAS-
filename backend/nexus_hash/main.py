"""Application factory.

``create_app(settings)`` builds a fully wired FastAPI instance. Tests pass
explicit settings; the server uses :func:`get_settings` (environment) via
uvicorn's factory mode, so importing this module has no side effects::

    uvicorn nexus_hash.main:create_app --factory
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from nexus_hash import API_VERSION, APP_NAME, TAGLINE, __version__
from nexus_hash.api import realtime as realtime_api
from nexus_hash.api import system as system_api
from nexus_hash.core.config import Settings, get_settings
from nexus_hash.core.errors import install_exception_handlers
from nexus_hash.core.logging import configure_logging
from nexus_hash.core.middleware import (
    BodySizeLimitMiddleware,
    RequestContextMiddleware,
    SecurityHeadersMiddleware,
)
from nexus_hash.core.realtime import RealtimeHub, Topic, run_system_heartbeat, system_heartbeat
from nexus_hash.db.engine import create_engine, create_session_factory
from nexus_hash.db.errors import install_database_error_handlers
from nexus_hash.db.migrate import current_revision, head_revision, upgrade_to_head
from nexus_hash.modules.activity import router as activity_api
from nexus_hash.modules.activity.schemas import ActivityCategory, ActivityLevel, NewActivity
from nexus_hash.modules.activity.service import ActivityService, run_retention
from nexus_hash.modules.hardware import router as hardware_api
from nexus_hash.modules.hardware.probe import Probe, SystemProbe
from nexus_hash.modules.hardware.service import HardwareMonitor
from nexus_hash.modules.hashlab import router as hashlab_api
from nexus_hash.modules.hashlab.jobs import ExecutorFactory, HashLabJobs, process_executor

logger = logging.getLogger("nexus_hash")

DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")


class SchemaOutOfDateError(RuntimeError):
    pass


async def _prepare_database(app: FastAPI, settings: Settings) -> ActivityService:
    """Create the engine, migrate (or verify) the schema, and build services."""
    engine = app.state.db_engine = create_engine(settings)
    head = head_revision()
    migration = None
    if settings.db_auto_migrate:
        migration = await asyncio.to_thread(upgrade_to_head, settings.database_sync_url)
        revision = migration.after
    else:
        revision = await asyncio.to_thread(current_revision, settings.database_sync_url)
        if revision != head:
            await engine.dispose()
            raise SchemaOutOfDateError(
                f"database schema is at {revision or 'nothing'} but this build needs {head}; "
                "run `uv run alembic upgrade head` or set NEXUS_DB_AUTO_MIGRATE=true"
            )
    app.state.schema_revision = revision

    activity = ActivityService(create_session_factory(engine), app.state.hub)
    if migration is not None and migration.changed:
        await activity.record(
            NewActivity(
                level=ActivityLevel.SUCCESS,
                category=ActivityCategory.DATABASE,
                message=f"Database schema migrated to revision {migration.after}",
                detail=f"Previous revision: {migration.before or 'none (new database)'}",
                context={"before": migration.before, "after": migration.after},
            )
        )
    return activity


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = app.state.settings
    started_at = app.state.started_at = time.monotonic()
    hub: RealtimeHub = app.state.hub
    hub.set_snapshot_provider(
        Topic.SYSTEM, lambda: ("heartbeat", system_heartbeat(hub, started_at))
    )

    activity = app.state.activity = await _prepare_database(app, settings)
    hashlab = app.state.hashlab = HashLabJobs(
        create_session_factory(app.state.db_engine),
        hub,
        activity,
        settings,
        executor_factory=app.state.hashlab_executor_factory,
    )
    await hashlab.recover_interrupted()

    hardware: HardwareMonitor | None = None
    if settings.hardware_monitoring_enabled:
        probe = await asyncio.to_thread(app.state.hardware_probe_factory)
        hardware = app.state.hardware = HardwareMonitor(
            probe, hub, create_session_factory(app.state.db_engine), activity, settings
        )
        await hardware.announce()
    await activity.record(
        NewActivity(
            level=ActivityLevel.INFO,
            category=ActivityCategory.SYSTEM,
            message=f"{APP_NAME} {__version__} started",
            detail=f"Environment: {settings.environment.value}",
            context={"version": __version__, "environment": settings.environment.value},
        )
    )

    tasks: dict[str, asyncio.Task[None]] = app.state.background_tasks
    tasks["system_heartbeat"] = asyncio.create_task(
        run_system_heartbeat(hub, settings.ws_heartbeat_seconds, started_at),
        name="nexus-system-heartbeat",
    )
    tasks["activity_retention"] = asyncio.create_task(
        run_retention(
            activity,
            interval=settings.retention_interval_seconds,
            max_age_days=settings.activity_retention_days,
            max_entries=settings.activity_max_entries,
        ),
        name="nexus-activity-retention",
    )
    if hardware is not None:
        tasks["hardware_monitor"] = asyncio.create_task(
            hardware.run(), name="nexus-hardware-monitor"
        )
    logger.info(
        "%s %s started",
        APP_NAME,
        __version__,
        extra={"fields": {"environment": settings.environment.value, "host": settings.host}},
    )
    try:
        yield
    finally:
        await hashlab.shutdown()
        for task in tasks.values():
            task.cancel()
        for task in tasks.values():
            with contextlib.suppress(asyncio.CancelledError):
                await task
        tasks.clear()
        if hardware is not None:
            try:
                await hardware.flush()  # keep the partial window
            except Exception:
                logger.exception("could not persist the last hardware window")
        try:
            await activity.record(
                NewActivity(
                    level=ActivityLevel.INFO,
                    category=ActivityCategory.SYSTEM,
                    message=f"{APP_NAME} stopping",
                )
            )
        except Exception:
            logger.exception("could not record shutdown in the activity log")
        await app.state.db_engine.dispose()
        logger.info("%s stopped", APP_NAME)


def create_app(
    settings: Settings | None = None,
    *,
    hashlab_executor_factory: ExecutorFactory = process_executor,
    hardware_probe_factory: Callable[[], Probe] = SystemProbe,
) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, settings.log_format, settings.secret_values())

    docs = settings.api_docs_enabled
    app = FastAPI(
        title=APP_NAME,
        summary=TAGLINE,
        version=__version__,
        lifespan=lifespan,
        docs_url="/docs" if docs else None,
        redoc_url="/redoc" if docs else None,
        openapi_url="/openapi.json" if docs else None,
    )

    app.state.settings = settings
    app.state.hub = RealtimeHub(settings.ws_max_connections, settings.ws_client_queue_size)
    app.state.started_at = time.monotonic()
    app.state.background_tasks = {}
    app.state.hashlab_executor_factory = hashlab_executor_factory
    app.state.hardware_probe_factory = hardware_probe_factory
    app.state.hardware = None

    install_exception_handlers(app)
    install_database_error_handlers(app)

    # add_middleware prepends, so the last one added is the outermost layer.
    # Effective order (outer -> inner): SecurityHeaders, CORS, RequestContext, BodySizeLimit.
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_request_body_bytes)
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["content-type", "x-request-id"],
        expose_headers=["x-request-id", "server-timing"],
        max_age=600,
    )
    app.add_middleware(SecurityHeadersMiddleware, csp_exempt_paths=DOCS_PATHS if docs else ())

    app.include_router(system_api.router, prefix=f"/api/{API_VERSION}")
    app.include_router(activity_api.router, prefix=f"/api/{API_VERSION}")
    app.include_router(hashlab_api.router, prefix=f"/api/{API_VERSION}")
    app.include_router(hardware_api.router, prefix=f"/api/{API_VERSION}")
    app.include_router(realtime_api.router)
    return app
