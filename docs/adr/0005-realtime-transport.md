# ADR 0005: Realtime transport — one multiplexed WebSocket with topic subscriptions

- **Status:** Accepted (Milestone 1, implemented)
- **Date:** 2026-11-05

## Context

The command dashboard shows live telemetry, simulation progress, network snapshots and agent
output. Options considered:

- polling only: simple, but laggy and wasteful
- Server-Sent Events: one-way, and one stream per concern
- WebSocket: bidirectional, one connection

## Decision

- A single WebSocket at `/ws/v1` per browser tab, carrying JSON text frames, with
  `subscribe`/`unsubscribe`/`ping` actions and typed server messages (`welcome`, `ack`, `pong`,
  `error`, `event`).
- An in-process `RealtimeHub` with:
  - a bounded per-client queue that drops the oldest message when full
  - a single writer task per socket
  - a connection cap
  - a message size cap
  - `Origin` allowlist enforcement (browsers don't apply CORS to WebSockets)
- On subscribe, the client receives the current state of each topic: a freshly computed snapshot
  where a provider is registered (live state such as the heartbeat), otherwise the last event.
- The client `RealtimeConnection` reconnects automatically with exponential backoff and jitter
  (1 s → 30 s cap) and is framework-agnostic (`useSyncExternalStore` binding).
- HTTP remains the source of truth for request/response operations. The stream is for push updates.

## Consequences

- Dashboards render immediately on load and recover from backend restarts without a page reload
  (verified in a real browser by killing and restarting the backend).
- An in-process hub means a single backend process. Scaling to multiple workers would need an
  external broker; that is out of scope for a local-first app.
