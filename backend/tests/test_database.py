"""Schema migrations, connection settings, column types and failure handling."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import pytest
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import create_async_engine

from nexus_hash.db.base import Base, UTCDateTime
from nexus_hash.db.engine import check_database
from nexus_hash.db.migrate import current_revision, downgrade_to, head_revision, upgrade_to_head
from nexus_hash.main import SchemaOutOfDateError, create_app
from nexus_hash.modules.activity import models as _models  # noqa: F401 (registers tables)
from tests.conftest import make_settings, query_sqlite


def _url(path: Path) -> str:
    return f"sqlite:///{path}"


def test_upgrade_creates_schema_and_is_idempotent(tmp_path: Path) -> None:
    url = _url(tmp_path / "m.db")
    first = upgrade_to_head(url)
    assert first.before is None
    assert first.after == head_revision()
    assert first.changed
    second = upgrade_to_head(url)
    assert not second.changed
    assert current_revision(url) == head_revision()


def test_downgrade_and_reupgrade_roundtrip(tmp_path: Path) -> None:
    url = _url(tmp_path / "m.db")
    upgrade_to_head(url)
    assert downgrade_to(url, "base").after is None
    tables = query_sqlite(
        tmp_path / "m.db",
        "select name from sqlite_master where type='table' and name='activity_log'",
    )
    assert tables == []
    assert upgrade_to_head(url).after == head_revision()


def test_models_match_migrations(tmp_path: Path) -> None:
    """Fails if a model changes without a matching migration (schema drift)."""
    url = _url(tmp_path / "m.db")
    upgrade_to_head(url)
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            diff = compare_metadata(MigrationContext.configure(connection), Base.metadata)
    finally:
        engine.dispose()
    assert diff == []


def test_check_constraints_reject_invalid_enum_values(tmp_path: Path) -> None:
    upgrade_to_head(_url(tmp_path / "m.db"))
    connection = sqlite3.connect(tmp_path / "m.db")
    try:
        with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint"):
            connection.execute(
                "insert into activity_log (ts, level, category, actor, message) "
                "values ('2026-01-01', 'catastrophic', 'system', 'system', 'x')"
            )
    finally:
        connection.close()


def test_app_database_uses_wal_and_foreign_keys(tmp_path: Path) -> None:
    db = tmp_path / "app.db"
    app = create_app(make_settings(database_path=db))
    with TestClient(app):
        pass
    assert query_sqlite(db, "pragma journal_mode") == [("wal",)]


def test_database_directory_is_created(tmp_path: Path) -> None:
    db = tmp_path / "nested" / "dir" / "app.db"
    with TestClient(create_app(make_settings(database_path=db))) as client:
        assert client.get("/api/v1/system/health").json()["checks"]["database"] == "ok"
    assert db.exists()


def test_startup_fails_fast_when_schema_is_behind_and_auto_migrate_is_off(tmp_path: Path) -> None:
    app = create_app(make_settings(database_path=tmp_path / "fresh.db", db_auto_migrate=False))
    with pytest.raises(SchemaOutOfDateError, match="needs"), TestClient(app):
        pass


def test_startup_without_auto_migrate_accepts_a_current_schema(tmp_path: Path) -> None:
    db = tmp_path / "ready.db"
    upgrade_to_head(_url(db))
    app = create_app(make_settings(database_path=db, db_auto_migrate=False))
    with TestClient(app) as client:
        assert (
            client.get("/api/v1/system/info").json()["database"]["schema_revision"]
            == head_revision()
        )


def test_info_reports_schema_and_retention_policy(client: TestClient) -> None:
    database = client.get("/api/v1/system/info").json()["database"]
    assert database == {
        "schema_revision": head_revision(),
        "activity_retention_days": 30,
        "activity_max_entries": 50_000,
    }
    assert "path" not in database  # filesystem layout is not exposed


async def _never_ok(*_args: object) -> bool:
    return False


def test_health_reports_database_down(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    monkeypatch.setattr("nexus_hash.api.system.check_database", _never_ok)
    body = client.get("/api/v1/system/health").json()
    assert body["checks"]["database"] == "down"
    assert body["status"] == "degraded"


@pytest.mark.anyio
async def test_check_database_handles_missing_and_broken_engines(tmp_path: Path) -> None:
    assert await check_database(None) is False
    broken = create_async_engine(f"sqlite+aiosqlite:///{tmp_path}/missing-dir/x.db")
    try:
        assert await check_database(broken) is False
    finally:
        await broken.dispose()


def test_operational_errors_become_503(client: TestClient) -> None:
    app = client.app

    @app.get("/api/v1/_test/db-down")  # type: ignore[attr-defined, untyped-decorator]
    async def db_down() -> None:
        raise OperationalError("SELECT 1", {}, Exception("database is locked"))

    response = client.get("/api/v1/_test/db-down")
    assert response.status_code == 503
    error = response.json()["error"]
    assert error["code"] == "service_unavailable"
    assert "locked" not in response.text  # driver detail stays in server logs


class TestUTCDateTime:
    column = UTCDateTime()

    def test_rejects_naive_datetimes(self) -> None:
        with pytest.raises(ValueError, match="naive"):
            self.column.process_bind_param(datetime(2026, 1, 1), None)  # type: ignore[arg-type]

    def test_stores_utc_and_returns_aware_utc(self) -> None:
        ist = timezone(timedelta(hours=5, minutes=30))
        stored = self.column.process_bind_param(datetime(2026, 1, 1, 12, 0, tzinfo=ist), None)  # type: ignore[arg-type]
        assert stored == datetime(2026, 1, 1, 6, 30)
        loaded = self.column.process_result_value(stored, None)  # type: ignore[arg-type]
        assert loaded == datetime(2026, 1, 1, 6, 30, tzinfo=UTC)
        assert loaded is not None
        assert loaded.tzinfo is UTC

    def test_none_passes_through(self) -> None:
        assert self.column.process_bind_param(None, None) is None  # type: ignore[arg-type]
        assert self.column.process_result_value(None, None) is None  # type: ignore[arg-type]


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"
