"""WebSocket protocol and hub behaviour."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from nexus_hash.core.realtime import RealtimeHub, Topic
from nexus_hash.main import create_app
from tests.conftest import TEST_ORIGIN, make_settings

WS_PATH = "/ws/v1"


def _receive_until(ws: Any, kind: str, limit: int = 20) -> dict[str, Any]:
    for _ in range(limit):
        message: dict[str, Any] = ws.receive_json()
        if message["kind"] == kind:
            return message
    raise AssertionError(f"no {kind!r} message within {limit} frames")


def test_welcome_on_connect(client: TestClient) -> None:
    with client.websocket_connect(WS_PATH) as ws:
        welcome = ws.receive_json()
    assert welcome["kind"] == "welcome"
    assert len(welcome["client_id"]) == 32
    assert set(welcome["topics_available"]) == {topic.value for topic in Topic}


def test_subscribe_receives_heartbeat(client: TestClient) -> None:
    with client.websocket_connect(WS_PATH) as ws:
        ws.receive_json()  # welcome
        ws.send_json({"action": "subscribe", "topics": ["system"]})
        ack = ws.receive_json()
        assert ack == {"kind": "ack", "action": "subscribe", "topics": ["system"]}
        # First event is a snapshot computed at subscribe time (not a stale
        # cached heartbeat), so it already counts this connection.
        snapshot = _receive_until(ws, "event")
        live = _receive_until(ws, "event")
    for event in (snapshot, live):
        assert event["topic"] == "system"
        assert event["type"] == "heartbeat"
        assert event["data"]["status"] == "ok"
        assert event["data"]["uptime_seconds"] >= 0
        assert event["data"]["connections"] >= 1
    assert live["ts"] >= snapshot["ts"]


def test_ping_pong(client: TestClient) -> None:
    with client.websocket_connect(WS_PATH) as ws:
        ws.receive_json()
        ws.send_json({"action": "ping"})
        pong = ws.receive_json()
        assert pong["kind"] == "pong"
        assert pong["id"] is None


def test_ping_id_is_echoed_for_latency_measurement(client: TestClient) -> None:
    with client.websocket_connect(WS_PATH) as ws:
        ws.receive_json()
        ws.send_json({"action": "ping", "id": "rtt-42"})
        assert ws.receive_json()["id"] == "rtt-42"


@pytest.mark.parametrize("bad_id", ["x" * 65, "has space", "<script>", ""])
def test_invalid_ping_ids_rejected(client: TestClient, bad_id: str) -> None:
    with client.websocket_connect(WS_PATH) as ws:
        ws.receive_json()
        ws.send_json({"action": "ping", "id": bad_id})
        assert ws.receive_json()["code"] == "invalid_message"


@pytest.mark.parametrize(
    "payload",
    [
        "not json",
        '{"action": "launch-miner"}',
        '{"action": "subscribe", "topics": ["dark-pool"]}',
        '{"action": "subscribe", "topics": []}',
    ],
)
def test_invalid_messages_get_error_and_connection_survives(
    client: TestClient, payload: str
) -> None:
    with client.websocket_connect(WS_PATH) as ws:
        ws.receive_json()
        ws.send_text(payload)
        error = ws.receive_json()
        assert error["kind"] == "error"
        assert error["code"] == "invalid_message"
        ws.send_json({"action": "ping"})
        assert ws.receive_json()["kind"] == "pong"


def test_binary_frames_rejected(client: TestClient) -> None:
    with client.websocket_connect(WS_PATH) as ws:
        ws.receive_json()
        ws.send_bytes(b"\x00\x01")
        assert ws.receive_json()["code"] == "unsupported_frame"


def test_unsubscribe_ack(client: TestClient) -> None:
    with client.websocket_connect(WS_PATH) as ws:
        ws.receive_json()
        ws.send_json({"action": "subscribe", "topics": ["system", "network"]})
        assert _receive_until(ws, "ack")["topics"] == ["network", "system"]
        ws.send_json({"action": "unsubscribe", "topics": ["system"]})
        assert _receive_until(ws, "ack")["topics"] == ["network"]


def test_oversized_message_closes_connection() -> None:
    app = create_app(make_settings(ws_max_message_bytes=256))
    with TestClient(app) as client, client.websocket_connect(WS_PATH) as ws:
        ws.receive_json()
        ws.send_text("x" * 1_000)
        with pytest.raises(WebSocketDisconnect) as excinfo:
            ws.receive_json()
    assert excinfo.value.code == 1009


def test_allowed_origin_accepted(client: TestClient) -> None:
    with client.websocket_connect(WS_PATH, headers={"origin": TEST_ORIGIN}) as ws:
        assert ws.receive_json()["kind"] == "welcome"


def test_cross_site_origin_rejected(client: TestClient) -> None:
    with (
        pytest.raises(WebSocketDisconnect) as excinfo,
        client.websocket_connect(WS_PATH, headers={"origin": "https://evil.test"}),
    ):
        pass
    assert excinfo.value.code == 1008


def test_connection_limit_enforced() -> None:
    app = create_app(make_settings(ws_max_connections=1))
    with TestClient(app) as client, client.websocket_connect(WS_PATH) as first:
        first.receive_json()
        with (
            pytest.raises(WebSocketDisconnect) as excinfo,
            client.websocket_connect(WS_PATH),
        ):
            pass
    assert excinfo.value.code == 1013


def test_disconnect_releases_slot() -> None:
    app = create_app(make_settings(ws_max_connections=1))
    with TestClient(app) as client:
        for _ in range(3):
            with client.websocket_connect(WS_PATH) as ws:
                assert ws.receive_json()["kind"] == "welcome"
        assert app.state.hub.connection_count == 0


# --- Hub unit tests -----------------------------------------------------------


def test_publish_reaches_only_subscribers() -> None:
    hub = RealtimeHub(max_connections=4, queue_size=8)
    subscribed, idle = hub.try_register(), hub.try_register()
    assert subscribed is not None
    assert idle is not None
    hub.subscribe(subscribed, [Topic.NETWORK])
    assert hub.publish(Topic.NETWORK, "snapshot", {"height": 1}) == 1
    assert idle.queue.empty()


def test_slow_client_drops_oldest_messages() -> None:
    hub = RealtimeHub(max_connections=1, queue_size=8)
    client = hub.try_register()
    assert client is not None
    hub.subscribe(client, [Topic.SYSTEM])  # enqueues one ack
    for i in range(20):
        hub.publish(Topic.SYSTEM, "tick", {"i": i})
    assert client.queue.qsize() == 8
    assert client.dropped == 13
    last = None
    while not client.queue.empty():
        last = client.queue.get_nowait()
    assert last is not None
    assert '"i":19' in last


def test_subscribe_replays_last_event() -> None:
    hub = RealtimeHub(max_connections=1, queue_size=8)
    hub.publish(Topic.NETWORK, "snapshot", {"height": 900_000})
    client = hub.try_register()
    assert client is not None
    hub.subscribe(client, [Topic.NETWORK])
    client.queue.get_nowait()  # ack
    assert '"height":900000' in client.queue.get_nowait()


def test_snapshot_provider_takes_precedence_over_cache() -> None:
    hub = RealtimeHub(max_connections=1, queue_size=8)
    hub.publish(Topic.SYSTEM, "heartbeat", {"connections": 0})  # stale
    hub.set_snapshot_provider(
        Topic.SYSTEM, lambda: ("heartbeat", {"connections": hub.connection_count})
    )
    client = hub.try_register()
    assert client is not None
    hub.subscribe(client, [Topic.SYSTEM])
    client.queue.get_nowait()  # ack
    assert '"connections":1' in client.queue.get_nowait()
    assert client.queue.empty()


def test_capacity_and_unregister() -> None:
    hub = RealtimeHub(max_connections=1, queue_size=8)
    client = hub.try_register()
    assert client is not None
    assert hub.try_register() is None
    hub.unregister(client)
    hub.unregister(client)  # idempotent
    assert hub.connection_count == 0
    assert hub.try_register() is not None
