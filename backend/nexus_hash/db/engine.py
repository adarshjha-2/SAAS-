"""Async engine and session factory for the application database."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from nexus_hash.core.config import Settings

logger = logging.getLogger("nexus_hash.db")

HEALTH_CHECK_TIMEOUT_SECONDS = 2.0

# Applied to every new SQLite connection.
_PRAGMAS = (
    "PRAGMA journal_mode=WAL",  # readers never block the writer
    "PRAGMA synchronous=NORMAL",  # durable with WAL, much faster than FULL
    "PRAGMA foreign_keys=ON",
    "PRAGMA busy_timeout=5000",  # wait for a lock instead of failing instantly
)


def _apply_pragmas(dbapi_connection: Any, _record: Any) -> None:
    cursor = dbapi_connection.cursor()
    try:
        for pragma in _PRAGMAS:
            cursor.execute(pragma)
    finally:
        cursor.close()


def create_engine(settings: Settings) -> AsyncEngine:
    """Create the engine, making sure the database directory exists."""
    path = settings.database_path.expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    event.listen(engine.sync_engine, "connect", _apply_pragmas)
    return engine


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def check_database(engine: AsyncEngine | None) -> bool:
    """True when the database answers a trivial query within the timeout."""
    if engine is None:
        return False
    try:
        async with asyncio.timeout(HEALTH_CHECK_TIMEOUT_SECONDS), engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
    except Exception:
        logger.warning("database health check failed", exc_info=True)
        return False
    return True
