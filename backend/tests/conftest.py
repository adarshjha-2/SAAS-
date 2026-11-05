from __future__ import annotations

import os
import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from nexus_hash.core.config import Settings, get_settings
from nexus_hash.main import create_app

TEST_ORIGIN = "http://localhost:5173"

# Set per test by the autouse fixture below, so no test can touch a real database.
_test_db_dir: Path | None = None


def make_settings(**overrides: Any) -> Settings:
    """Hermetic settings: never read .env files, fast heartbeat, private database."""
    if _test_db_dir is None:  # pragma: no cover - guarded by the autouse fixture
        raise RuntimeError("make_settings() used outside a test")
    values: dict[str, Any] = {
        "environment": "test",
        "log_level": "WARNING",
        "ws_heartbeat_seconds": 0.05,
        "database_path": _test_db_dir / "nexus_test.db",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)  # type: ignore[call-arg]


def query_sqlite(path: Path, sql: str) -> list[tuple[object, ...]]:
    """Run a read-only query with a connection that is always closed."""
    connection = sqlite3.connect(path)
    try:
        return connection.execute(sql).fetchall()
    finally:
        connection.close()


@pytest.fixture(autouse=True)
def _isolate_environment(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[None]:
    global _test_db_dir  # noqa: PLW0603 - per-test isolation for make_settings()
    for key in list(os.environ):
        if key.startswith("NEXUS_") or key == "ANTHROPIC_API_KEY":
            monkeypatch.delenv(key, raising=False)
    # Settings built from the environment (get_settings) must also stay out of real data.
    monkeypatch.setenv("NEXUS_DATABASE_PATH", str(tmp_path / "env.db"))
    _test_db_dir = tmp_path
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
    _test_db_dir = None


@pytest.fixture
def settings() -> Settings:
    return make_settings()


@pytest.fixture
def app(settings: Settings) -> FastAPI:
    return create_app(settings)


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client
