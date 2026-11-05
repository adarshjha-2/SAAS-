"""WebSocket endpoint for live dashboard updates.

Protocol (JSON text frames):

* client -> server: ``{"action": "subscribe" | "unsubscribe", "topics": [...]}``
  or ``{"action": "ping"}``
* server -> client: ``welcome``, ``ack``, ``pong``, ``error`` and ``event``
  messages (see :mod:`nexus_hash.core.realtime`).

Browsers do not apply CORS to WebSockets, so the ``Origin`` header is checked
against the same allowlist to prevent cross-site WebSocket hijacking.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging

from fastapi import APIRouter, WebSocket
from pydantic import ValidationError
from starlette.websockets import WebSocketDisconnect, WebSocketState

from nexus_hash import API_VERSION
from nexus_hash.core.config import Settings
from nexus_hash.core.realtime import (
    ErrorMessage,
    PingMessage,
    PongMessage,
    RealtimeClient,
    RealtimeHub,
    SubscribeMessage,
    UnsubscribeMessage,
    WelcomeMessage,
    client_message_adapter,
)

logger = logging.getLogger("nexus_hash.realtime")

router = APIRouter()

WS_POLICY_VIOLATION = 1008
WS_MESSAGE_TOO_BIG = 1009
WS_TRY_AGAIN_LATER = 1013


async def _pump(websocket: WebSocket, client: RealtimeClient) -> None:
    """Single writer for this socket: drains the client's queue in order."""
    with contextlib.suppress(WebSocketDisconnect, RuntimeError):
        while True:
            payload = await client.queue.get()
            await websocket.send_text(payload)


def _dispatch(raw: str, client: RealtimeClient, hub: RealtimeHub) -> None:
    """Validate one client frame and apply it."""
    try:
        parsed = client_message_adapter.validate_json(raw)
    except ValidationError:
        client.offer(
            ErrorMessage(
                code="invalid_message",
                message="Expected {action: subscribe|unsubscribe|ping, topics?: [...]}.",
            )
        )
        return

    if isinstance(parsed, SubscribeMessage):
        hub.subscribe(client, parsed.topics)
    elif isinstance(parsed, UnsubscribeMessage):
        hub.unsubscribe(client, parsed.topics)
    elif isinstance(parsed, PingMessage):
        client.offer(PongMessage())


def _origin_allowed(origin: str | None, settings: Settings) -> bool:
    # Non-browser clients (CLI tools, tests) send no Origin; browsers always do.
    return origin is None or origin.rstrip("/") in settings.cors_origins


@router.websocket(f"/ws/{API_VERSION}")
async def realtime_stream(websocket: WebSocket) -> None:
    settings: Settings = websocket.app.state.settings
    hub: RealtimeHub = websocket.app.state.hub

    origin = websocket.headers.get("origin")
    if not _origin_allowed(origin, settings):
        logger.warning("rejected websocket origin", extra={"fields": {"origin": origin}})
        await websocket.close(code=WS_POLICY_VIOLATION)
        return

    client = hub.try_register()
    if client is None:
        await websocket.close(code=WS_TRY_AGAIN_LATER)
        return

    await websocket.accept()
    client.offer(WelcomeMessage(client_id=client.id))
    sender = asyncio.create_task(_pump(websocket, client), name=f"ws-send-{client.id}")

    try:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break
            raw = message.get("text")
            if raw is None:
                client.offer(ErrorMessage(code="unsupported_frame", message="Send JSON text."))
            elif len(raw.encode()) > settings.ws_max_message_bytes:
                await websocket.close(code=WS_MESSAGE_TOO_BIG)
                break
            else:
                _dispatch(raw, client, hub)
    except WebSocketDisconnect:
        pass
    finally:
        hub.unregister(client)
        sender.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await sender
        if websocket.client_state is WebSocketState.CONNECTED:
            with contextlib.suppress(RuntimeError):
                await websocket.close()
