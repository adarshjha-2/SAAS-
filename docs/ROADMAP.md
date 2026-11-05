# NEXUS HASH AI — Delivery Roadmap

Each milestone ends with a report covering what was built, which files changed, which tests ran,
which bugs were found and fixed, and what remains. A module's catalog status (`core/catalog.py`)
moves to `online` only when its acceptance criteria are met and tested.

| # | Milestone | Status |
|---|---|---|
| 1 | Project architecture & environment setup | ✅ Complete |
| 2 | Frontend design system & command dashboard | ✅ Complete |
| 3 | Backend persistence (SQLite) & activity log | ✅ Complete |
| 4 | HashLab proof-of-work simulator | ✅ Complete |
| 5 | Hardware Intelligence | ⏭ Next |
| 6 | Bitcoin Network Intelligence | Planned |
| 7 | Profitability Intelligence | Planned |
| 8 | Nexus Intelligence + NEXUS CORE AI | Planned |
| 9 | Testing, security & optimisation | Planned |
| 10 | Deployment & documentation | Planned |

## Acceptance criteria

### M1: Architecture & environment ✅

- Architecture, ADRs, security policy and roadmap documented.
- Backend: app factory, validated config, error envelope, middleware stack, realtime hub, system
  endpoints, CLI.
- Frontend: design tokens, app shell, routing, API client, self-healing realtime connection, live
  platform-status view.
- Tooling: Makefile, `scripts/dev.sh`, `.env.example` (validated by a test), CI workflow.
- All lint, type and test gates green. A browser smoke test passed, including backend kill and
  recovery.

### M2: Frontend design & dashboard ✅

- Design system: `Panel`, `StatTile` + `Sparkline`, `TimeSeriesChart` (with table twin),
  `ProvenanceBadge`, `EmptyState`, `SegmentedControl`, `ConsentDialog`.
- Validated data-series palette for the dark surface, plus documented chart conventions.
- Command dashboard backed by live measurements: status tiles, latency telemetry (WebSocket
  ping/pong with echoed IDs, API health timing), session activity log, honest module slots.
- Truthfulness rules tested: no stale-as-live, gaps never interpolated, provenance on every figure.
- Route-level code splitting and a skip-to-content link. Nexus Command is marked `online` in the
  catalog.
- Toasts were deferred: the activity log covers event notification without interrupting the user.

### M3: Backend & database ✅

- SQLite (WAL) via async SQLAlchemy 2.x and `aiosqlite`. A packaged Alembic migration (`0001`)
  runs automatically at startup, or startup fails fast when auto-migrate is off. A test fails on
  schema drift.
- `/health` gains a database check, `/info` reports the schema revision and retention policy, and
  database outages become 503s.
- Activity log with repository, service and a read-only paginated, filterable API, live on the
  `activity` topic. A retention job enforces age and count limits.
- Real server events recorded: start, stop, migration, retention.
- Frontend: server entries merged into the dashboard feed (deduplicated, with backfill after
  reconnect) and a full `/activity` page with filters and pagination.

### M4: HashLab ✅

- Header serialisation and double SHA-256, verified against the genesis block and block 1. Compact
  `bits` ↔ target conversion follows Bitcoin Core's validity rules.
- Instant demos: SHA-256 with the avalanche effect, a block-header lab, and a nonce explorer.
- Mining and benchmark jobs:
  - one spawned, low-priority worker process with adaptive 0.25 s chunks
  - limits, the consent gate and one-at-a-time admission
  - cancellation, live progress, persistence (`simulation_runs`) and activity audit
  - crash recovery
- Poisson mining competition in simulated time, reproducible with a seed and statistically tested.
- HashLab page with the consent dialog, plus a live Mining simulation panel on the dashboard. Every
  output is labelled simulated.

### M5: Hardware Intelligence

- psutil, NVML and RAPL providers with an explicit capability matrix. Sampler, ring buffer and
  history.
- Unsupported metrics shown as unavailable, never as zero.

### M6: Bitcoin Network Intelligence

- Provider chain (mempool.space → blockchain.info → CoinGecko price), TTL cache, circuit breaker.
- Stale-while-error with `as_of` and `source`. Host allowlist. Snapshot history.

### M7: Profitability Intelligence

- Validated calculator with scenarios, Poisson variance, sensitivity and break-even.
- Assumptions and uncertainty always shown. No guarantee language.

### M8: Nexus Intelligence & NEXUS CORE

- Deterministic analytics: efficiency, anomaly detection, rules with evidence, strategy comparison.
- LLM provider abstraction (backend-only key), grounded context, streaming, budgets, offline mode,
  advisory-only actions.

### M9: Testing, security & optimisation

- Playwright E2E in CI, API rate limiting, optional local API token, dependency and secret scanning.
- Load tests for the realtime hub. Performance budgets.

### M10: Deployment & documentation

- FastAPI serves the built SPA. Docker image (non-root, read-only rootfs). User and operator guides.
- No paid infrastructure without approval.
