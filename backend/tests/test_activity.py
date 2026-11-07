"""Activity log: service, retention, HTTP API and live push."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from nexus_hash.core.realtime import RealtimeHub, Topic
from nexus_hash.db.engine import create_engine, create_session_factory
from nexus_hash.db.migrate import head_revision, upgrade_to_head
from nexus_hash.main import create_app
from nexus_hash.modules.activity.schemas import (
    ActivityActor,
    ActivityCategory,
    ActivityLevel,
    NewActivity,
)
from nexus_hash.modules.activity.service import ActivityService, run_retention
from tests.conftest import make_settings, query_sqlite


def _entry(message: str, **overrides: Any) -> NewActivity:
    values: dict[str, Any] = {
        "level": ActivityLevel.INFO,
        "category": ActivityCategory.SYSTEM,
        "message": message,
    }
    values.update(overrides)
    return NewActivity(**values)


# --- Schema validation ---------------------------------------------------------


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("message", ""),
        ("message", "   "),
        ("message", "x" * 501),
        ("detail", "y" * 2_001),
        ("context", {"blob": "z" * 5_000}),
    ],
)
def test_new_activity_validation(field: str, value: Any) -> None:
    values: dict[str, Any] = {"level": "info", "category": "system", "message": "ok", field: value}
    with pytest.raises(ValidationError):
        NewActivity(**values)


def test_new_activity_normalises_text_and_context() -> None:
    entry = _entry("  hello  ", detail=" why ", context={"when": datetime(2026, 1, 1, tzinfo=UTC)})
    assert entry.message == "hello"
    assert entry.detail == "why"
    assert entry.context == {"when": "2026-01-01 00:00:00+00:00"}  # JSON-safe
    assert entry.actor is ActivityActor.SYSTEM


# --- Service (async, against a real migrated database) -------------------------


class FakeClock:
    def __init__(self) -> None:
        self.now = datetime(2026, 11, 5, 12, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
async def sessions(tmp_path: Path) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    settings = make_settings(database_path=tmp_path / "svc.db")
    upgrade_to_head(settings.database_sync_url)
    engine = create_engine(settings)
    yield create_session_factory(engine)
    await engine.dispose()


@pytest.mark.anyio
async def test_record_persists_and_publishes(sessions: async_sessionmaker[AsyncSession]) -> None:
    hub = RealtimeHub(max_connections=1, queue_size=8)
    client = hub.try_register()
    assert client is not None
    hub.subscribe(client, [Topic.ACTIVITY])
    client.queue.get_nowait()  # ack

    clock = FakeClock()
    service = ActivityService(sessions, hub, clock)
    saved = await service.record(_entry("Started", context={"version": "0.1.0"}))

    assert saved.id >= 1
    assert saved.ts == clock.now
    assert saved.ts.tzinfo is UTC
    event = client.queue.get_nowait()
    assert '"topic":"activity"' in event
    assert '"message":"Started"' in event
    page = await service.page(limit=10)
    assert [item.message for item in page.items] == ["Started"]
    assert page.items[0].context == {"version": "0.1.0"}


@pytest.mark.anyio
async def test_keyset_pagination_walks_every_entry_once(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    service = ActivityService(sessions, RealtimeHub(1, 8))
    for i in range(7):
        await service.record(_entry(f"event {i}"))

    seen: list[str] = []
    before: int | None = None
    pages = 0
    while True:
        page = await service.page(limit=3, before_id=before)
        seen.extend(item.message for item in page.items)
        pages += 1
        if page.next_before_id is None:
            break
        before = page.next_before_id
    assert seen == [f"event {i}" for i in reversed(range(7))]
    assert pages == 3


@pytest.mark.anyio
async def test_filters_by_level_and_category(sessions: async_sessionmaker[AsyncSession]) -> None:
    service = ActivityService(sessions, RealtimeHub(1, 8))
    await service.record(_entry("boot"))
    await service.record(
        _entry("migrated", level=ActivityLevel.SUCCESS, category=ActivityCategory.DATABASE)
    )
    await service.record(
        _entry("oops", level=ActivityLevel.ERROR, category=ActivityCategory.DATABASE)
    )

    errors = await service.page(limit=10, level=ActivityLevel.ERROR)
    assert [item.message for item in errors.items] == ["oops"]
    database = await service.page(limit=10, category=ActivityCategory.DATABASE)
    assert [item.message for item in database.items] == ["oops", "migrated"]
    both = await service.page(
        limit=10, level=ActivityLevel.SUCCESS, category=ActivityCategory.DATABASE
    )
    assert [item.message for item in both.items] == ["migrated"]


@pytest.mark.anyio
async def test_retention_removes_old_entries_then_trims_to_cap(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    clock = FakeClock()
    service = ActivityService(sessions, RealtimeHub(1, 8), clock)
    start = clock.now
    clock.now = start - timedelta(days=40)
    await service.record(_entry("ancient"))
    clock.now = start - timedelta(days=10)
    for i in range(5):
        await service.record(_entry(f"recent {i}"))
    clock.now = start

    removed = await service.apply_retention(max_age_days=30, max_entries=3)
    assert removed == 3  # 1 too old + 2 beyond the cap
    remaining = await service.page(limit=10)
    assert [item.message for item in remaining.items] == ["recent 4", "recent 3", "recent 2"]
    assert await service.apply_retention(max_age_days=30, max_entries=3) == 0


@pytest.mark.anyio
async def test_retention_job_records_what_it_removed(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    clock = FakeClock()
    service = ActivityService(sessions, RealtimeHub(1, 8), clock)
    clock.now -= timedelta(days=90)
    await service.record(_entry("stale"))
    clock.now += timedelta(days=90)

    job = asyncio.create_task(
        run_retention(service, interval=3_600, max_age_days=30, max_entries=100)
    )
    for _ in range(50):
        page = await service.page(limit=10)
        if page.items and page.items[0].category is ActivityCategory.DATABASE:
            break
        await asyncio.sleep(0.01)
    job.cancel()
    with pytest.raises(asyncio.CancelledError):
        await job

    newest = (await service.page(limit=10)).items
    assert [item.message for item in newest] == ["Retention removed 1 activity entry"]
    assert newest[0].context == {"removed": 1}


@pytest.mark.anyio
async def test_retention_job_survives_failures(sessions: async_sessionmaker[AsyncSession]) -> None:
    calls = 0

    class FlakyService(ActivityService):
        async def apply_retention(self, *, max_age_days: int, max_entries: int) -> int:
            nonlocal calls
            calls += 1
            raise RuntimeError("disk on fire")

    job = asyncio.create_task(
        run_retention(
            FlakyService(sessions, RealtimeHub(1, 8)),
            interval=0.01,
            max_age_days=1,
            max_entries=100,
        )
    )
    await asyncio.sleep(0.1)
    job.cancel()
    with pytest.raises(asyncio.CancelledError):
        await job
    assert calls >= 2  # kept retrying instead of dying


# --- HTTP API ------------------------------------------------------------------


def test_startup_records_real_events(client: TestClient) -> None:
    body = client.get("/api/v1/activity").json()
    messages = [item["message"] for item in body["items"]]
    # Newest first: ready, then each module's start-up report, then the migration.
    assert messages == [
        "NEXUS HASH AI 0.1.0 started",
        "Hardware monitoring started",
        f"Database schema migrated to revision {head_revision()}",
    ]
    assert body["next_before_id"] is None
    started = body["items"][0]
    assert started["category"] == "system"
    assert started["actor"] == "system"
    assert started["context"] == {"version": "0.1.0", "environment": "test"}
    assert started["ts"].endswith("Z") or started["ts"].endswith("+00:00")


def test_restart_does_not_rerecord_migration(tmp_path: Path) -> None:
    settings = make_settings(database_path=tmp_path / "restart.db")
    for _ in range(2):
        with TestClient(create_app(settings)):
            pass
    with TestClient(create_app(settings)) as client:
        messages = [item["message"] for item in client.get("/api/v1/activity").json()["items"]]
    assert messages.count(f"Database schema migrated to revision {head_revision()}") == 1
    assert messages.count("NEXUS HASH AI stopping") == 2
    assert messages.count("NEXUS HASH AI 0.1.0 started") == 3


def test_shutdown_is_recorded(tmp_path: Path) -> None:
    db = tmp_path / "shutdown.db"
    with TestClient(create_app(make_settings(database_path=db))):
        pass
    rows = query_sqlite(db, "select message from activity_log order by id")
    assert rows[-1] == ("NEXUS HASH AI stopping",)


def test_api_paginates_and_filters(client: TestClient) -> None:
    service: ActivityService = client.app.state.activity  # type: ignore[attr-defined]
    assert client.portal is not None
    for i in range(4):
        client.portal.call(service.record, _entry(f"tick {i}", category=ActivityCategory.HASHLAB))

    first = client.get("/api/v1/activity", params={"limit": 3}).json()
    assert [item["message"] for item in first["items"]] == ["tick 3", "tick 2", "tick 1"]
    second = client.get(
        "/api/v1/activity", params={"limit": 3, "before_id": first["next_before_id"]}
    ).json()
    assert second["items"][0]["message"] == "tick 0"

    hashlab = client.get("/api/v1/activity", params={"category": "hashlab"}).json()
    assert len(hashlab["items"]) == 4
    assert client.get("/api/v1/activity", params={"level": "error"}).json()["items"] == []


@pytest.mark.parametrize(
    "params",
    [
        {"limit": 0},
        {"limit": 201},
        {"before_id": 0},
        {"level": "fatal"},
        {"category": "mining-pool"},
    ],
)
def test_api_rejects_invalid_queries(client: TestClient, params: dict[str, Any]) -> None:
    response = client.get("/api/v1/activity", params=params)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_api_is_read_only(client: TestClient) -> None:
    assert client.post("/api/v1/activity", json={"message": "forged"}).status_code == 405


def test_new_entries_are_pushed_on_the_activity_topic(client: TestClient) -> None:
    service: ActivityService = client.app.state.activity  # type: ignore[attr-defined]
    assert client.portal is not None
    with client.websocket_connect("/ws/v1") as ws:
        ws.receive_json()  # welcome
        ws.send_json({"action": "subscribe", "topics": ["activity"]})
        assert ws.receive_json()["kind"] == "ack"
        replayed = ws.receive_json()  # last entry so far, so dashboards render at once
        assert replayed["data"]["message"] == "NEXUS HASH AI 0.1.0 started"

        client.portal.call(service.record, _entry("Benchmark finished", actor=ActivityActor.USER))
        event = ws.receive_json()
    assert event["kind"] == "event"
    assert event["topic"] == "activity"
    assert event["type"] == "entry"
    assert event["data"]["message"] == "Benchmark finished"
    assert event["data"]["actor"] == "user"
    assert isinstance(event["data"]["id"], int)
