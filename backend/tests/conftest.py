from __future__ import annotations

import os
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from nexus_hash.core.config import Settings, get_settings
from nexus_hash.main import create_app

TEST_ORIGIN = "http://localhost:5173"


def make_settings(**overrides: Any) -> Settings:
    """Hermetic settings: never read .env files, fast heartbeat."""
    values: dict[str, Any] = {
        "environment": "test",
        "log_level": "WARNING",
        "ws_heartbeat_seconds": 0.05,
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)  # type: ignore[call-arg]


@pytest.fixture(autouse=True)
def _isolate_environment(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    for key in list(os.environ):
        if key.startswith("NEXUS_") or key == "ANTHROPIC_API_KEY":
            monkeypatch.delenv(key, raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


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
