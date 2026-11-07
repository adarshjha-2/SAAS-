# ADR 0003: Bitcoin network data providers and graceful degradation

- **Status:** Accepted (Milestone 1; implemented in Milestone 6)
- **Date:** 2026-11-05

## Context

Price, difficulty, height, hash rate and mempool data come from public, unauthenticated APIs that
can be rate-limited or unavailable. Reachability was probed from the development environment on
2026-11-05:

| Provider | Result |
|---|---|
| mempool.space (`/api/blocks/tip/height`, `/api/v1/prices`, `/api/v1/difficulty-adjustment`) | 200 OK |
| blockchain.info (`/q/getblockcount`) | 200 OK |
| CoinGecko (`/api/v3/simple/price`) | **429 Too Many Requests** |

## Decision

- Provider chain in priority order: **mempool.space → blockchain.info**, with **CoinGecko as a
  last-resort price source only**.
- Each metric has a TTL cache (about 15–60 s), a per-request timeout and a circuit breaker per
  provider.
- When every provider fails, serve the last good value with `stale: true`. Every value carries
  `source` and `as_of`. With no value at all, return `upstream_unavailable` (HTTP 503) instead of
  inventing one.
- Values derived rather than fetched (block subsidy from height; implied hash rate from difficulty
  × 2³² / 600) are flagged `derived: true`.
- Outbound requests are restricted to an allowlist of these hosts.

## Consequences

- The dashboard keeps working through provider outages and is honest about freshness.
- Providers sit behind a common interface, so a self-hosted node (Bitcoin Core RPC or a local
  mempool instance) can be added later without touching consumers.
