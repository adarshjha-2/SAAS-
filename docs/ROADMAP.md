# NEXUS HASH AI — Delivery Roadmap

Each milestone ends with a report covering what was built, which files changed, which tests ran,
which bugs were found and fixed, and what remains. A module's catalog status (`core/catalog.py`)
moves to `online` only when its acceptance criteria are met and tested.

| # | Milestone | Status |
|---|---|---|
| 1 | Project architecture & environment setup | ✅ Complete |
| 2 | Frontend design system & command dashboard | ⏭ Next |
| 3 | Backend persistence (SQLite) & activity log | Planned |
| 4 | HashLab proof-of-work simulator | Planned |
| 5 | Hardware Intelligence | Planned |
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

### M2: Frontend design & dashboard

- Design-system primitives: stat tiles, charts, tables, empty/stale/error states, toasts, consent
  dialog.
- Command dashboard layout with Recharts panels bound to realtime topics.
- Activity log UI (backed by M3). Route-level code splitting.

### M3: Backend & database

- SQLAlchemy 2.0 + Alembic and SQLite in WAL mode. Repositories, with a DB check in `/health`.
- Activity log service plus API, published on the `activity` topic. Retention jobs.

### M4: HashLab

- Header serialisation and double SHA-256, verified against the Bitcoin genesis block.
- Difficulty and target math, plus nonce search in an isolated worker process with hard limits and
  cancellation.
- Consent-gated benchmark. Poisson mining-competition simulation. Every output labelled
  "simulated".

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
