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
from collections.abc import AsyncIterator
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

logger = logging.getLogger("nexus_hash")

DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = app.state.settings
    started_at = app.state.started_at = time.monotonic()
    hub: RealtimeHub = app.state.hub
    hub.set_snapshot_provider(
        Topic.SYSTEM, lambda: ("heartbeat", system_heartbeat(hub, started_at))
    )
    tasks: dict[str, asyncio.Task[None]] = app.state.background_tasks
    tasks["system_heartbeat"] = asyncio.create_task(
        run_system_heartbeat(hub, settings.ws_heartbeat_seconds, started_at),
        name="nexus-system-heartbeat",
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
        for task in tasks.values():
            task.cancel()
        for task in tasks.values():
            with contextlib.suppress(asyncio.CancelledError):
                await task
        tasks.clear()
        logger.info("%s stopped", APP_NAME)


def create_app(settings: Settings | None = None) -> FastAPI:
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

    install_exception_handlers(app)

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
    app.include_router(realtime_api.router)
    return app
