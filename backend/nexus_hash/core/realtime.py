"""In-process publish/subscribe hub for live dashboard updates.

Design:

* One multiplexed WebSocket per browser tab; clients subscribe to topics.
* Each client has a *bounded* outbound queue. If a client is too slow, the
  oldest messages are dropped (and counted) rather than letting memory grow.
* All socket writes for a client happen in a single sender task, so frames
  are never interleaved.
* On subscribe a client immediately receives the current state of each topic,
  so a freshly opened dashboard renders without waiting for the next tick.
  Topics with a *snapshot provider* (live state such as the system heartbeat)
  get a freshly computed snapshot; other topics replay their last event.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, TypeAdapter

from nexus_hash import __version__

logger = logging.getLogger("nexus_hash.realtime")


class Topic(StrEnum):
    """Realtime channels. Publishers are added by the milestone that owns each one."""

    SYSTEM = "system"  # Milestone 1: heartbeat / uptime / connection count
    ACTIVITY = "activity"  # Milestone 3: activity log entries
    HASHLAB = "hashlab"  # Milestone 4: simulation progress
    HARDWARE = "hardware"  # Milestone 5: telemetry samples
    NETWORK = "network"  # Milestone 6: network snapshots
    INTELLIGENCE = "intelligence"  # Milestone 8: recommendations / anomalies


# --- Client -> server messages ------------------------------------------------


class SubscribeMessage(BaseModel):
    action: Literal["subscribe"]
    topics: list[Topic] = Field(min_length=1, max_length=len(Topic))


class UnsubscribeMessage(BaseModel):
    action: Literal["unsubscribe"]
    topics: list[Topic] = Field(min_length=1, max_length=len(Topic))


class PingMessage(BaseModel):
    action: Literal["ping"]
    # Optional correlation id, echoed in the pong so clients can measure
    # round-trip latency precisely.
    id: str | None = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9_\-]+$")


ClientMessage = Annotated[
    SubscribeMessage | UnsubscribeMessage | PingMessage,
    Field(discriminator="action"),
]
client_message_adapter: TypeAdapter[ClientMessage] = TypeAdapter(ClientMessage)


# --- Server -> client messages ------------------------------------------------


def _now() -> datetime:
    return datetime.now(UTC)


class WelcomeMessage(BaseModel):
    kind: Literal["welcome"] = "welcome"
    client_id: str
    server_version: str = __version__
    topics_available: list[Topic] = Field(default_factory=lambda: list(Topic))


class AckMessage(BaseModel):
    kind: Literal["ack"] = "ack"
    action: Literal["subscribe", "unsubscribe"]
    topics: list[Topic]


class PongMessage(BaseModel):
    kind: Literal["pong"] = "pong"
    id: str | None = None
    ts: datetime = Field(default_factory=_now)


class ErrorMessage(BaseModel):
    kind: Literal["error"] = "error"
    code: str
    message: str


class EventMessage(BaseModel):
    kind: Literal["event"] = "event"
    topic: Topic
    type: str
    ts: datetime = Field(default_factory=_now)
    data: dict[str, Any]


ServerMessage = WelcomeMessage | AckMessage | PongMessage | ErrorMessage | EventMessage

# Returns (event_type, data) describing a topic's current state.
SnapshotProvider = Callable[[], tuple[str, dict[str, Any]]]


class RealtimeClient:
    """Server-side state for one WebSocket connection."""

    def __init__(self, queue_size: int) -> None:
        self.id = uuid.uuid4().hex
        self.topics: set[Topic] = set()
        self.queue: asyncio.Queue[str] = asyncio.Queue(maxsize=queue_size)
        self.dropped = 0
        self.connected_at = time.monotonic()

    def offer(self, message: ServerMessage) -> None:
        """Enqueue without blocking; drop the oldest message if the queue is full."""
        payload = message.model_dump_json()
        if self.queue.full():
            try:
                self.queue.get_nowait()
                self.dropped += 1
            except asyncio.QueueEmpty:  # pragma: no cover - race-free in a single loop
                pass
        self.queue.put_nowait(payload)


class RealtimeHub:
    def __init__(self, max_connections: int, queue_size: int) -> None:
        self.max_connections = max_connections
        self.queue_size = queue_size
        self._clients: dict[str, RealtimeClient] = {}
        self._last_event: dict[Topic, EventMessage] = {}
        self._snapshot_providers: dict[Topic, SnapshotProvider] = {}

    @property
    def connection_count(self) -> int:
        return len(self._clients)

    def set_snapshot_provider(self, topic: Topic, provider: SnapshotProvider) -> None:
        """Compute fresh state for ``topic`` on subscribe instead of replaying the cache."""
        self._snapshot_providers[topic] = provider

    def try_register(self) -> RealtimeClient | None:
        """Register a new client, or return ``None`` when at capacity."""
        if len(self._clients) >= self.max_connections:
            return None
        client = RealtimeClient(self.queue_size)
        self._clients[client.id] = client
        logger.debug("realtime client connected", extra={"fields": {"client_id": client.id}})
        return client

    def unregister(self, client: RealtimeClient) -> None:
        if self._clients.pop(client.id, None) is not None:
            logger.debug(
                "realtime client disconnected",
                extra={"fields": {"client_id": client.id, "dropped": client.dropped}},
            )

    def subscribe(self, client: RealtimeClient, topics: list[Topic]) -> list[Topic]:
        added = [topic for topic in dict.fromkeys(topics) if topic not in client.topics]
        client.topics.update(added)
        client.offer(AckMessage(action="subscribe", topics=sorted(client.topics)))
        for topic in added:
            provider = self._snapshot_providers.get(topic)
            if provider is not None:
                event_type, data = provider()
                client.offer(EventMessage(topic=topic, type=event_type, data=data))
            elif (cached := self._last_event.get(topic)) is not None:
                client.offer(cached)
        return added

    def unsubscribe(self, client: RealtimeClient, topics: list[Topic]) -> None:
        client.topics.difference_update(topics)
        client.offer(AckMessage(action="unsubscribe", topics=sorted(client.topics)))

    def publish(self, topic: Topic, event_type: str, data: dict[str, Any]) -> int:
        """Fan an event out to every subscriber. Returns the number of recipients."""
        event = EventMessage(topic=topic, type=event_type, data=data)
        self._last_event[topic] = event
        recipients = 0
        for client in self._clients.values():
            if topic in client.topics:
                client.offer(event)
                recipients += 1
        return recipients


def system_heartbeat(hub: RealtimeHub, started_at: float) -> dict[str, Any]:
    """Current platform liveness, as sent on the ``system`` topic."""
    return {
        "status": "ok",
        "version": __version__,
        "uptime_seconds": round(time.monotonic() - started_at, 3),
        "server_time": _now().isoformat(),
        "connections": hub.connection_count,
    }


async def run_system_heartbeat(hub: RealtimeHub, interval: float, started_at: float) -> None:
    """Publish a ``system`` heartbeat every ``interval`` seconds until cancelled."""
    while True:
        hub.publish(Topic.SYSTEM, "heartbeat", system_heartbeat(hub, started_at))
        await asyncio.sleep(interval)
