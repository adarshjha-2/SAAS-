# NEXUS HASH AI

**Intelligence Beyond Computational Limits.**

NEXUS HASH AI is an AI-powered Bitcoin mining intelligence and research platform. It brings
together proof-of-work simulation, hardware monitoring, live network data, profitability modelling
and an AI analyst called **NEXUS CORE**, all in one command-center interface.

> **What it is not:** NEXUS HASH AI does not mine bitcoin, connect to pools, or claim any shortcut
> around proof-of-work. HashLab is a clearly labelled educational simulator. Profitability figures
> are estimates with stated assumptions, never guarantees. No intensive workload ever starts
> without your explicit permission.

## Status

**Milestones 1–5 of 10 are complete.** These are in place:

- the platform foundation and design system
- a live Nexus Command dashboard
- SQLite persistence with a server activity log
- the HashLab proof-of-work simulator
- read-only Hardware Intelligence

See [`docs/ROADMAP.md`](docs/ROADMAP.md).

| Module | Milestone | Status |
|---|---|---|
| Nexus Command (dashboard) | 2 | **Online** |
| HashLab (PoW simulator) | 4 | **Online** |
| Hardware Intelligence | 5 | **Online** |
| Bitcoin Network Intelligence | 6 | Planned |
| Profitability Intelligence | 7 | Planned |
| Nexus Intelligence + NEXUS CORE | 8 | Planned |

## Quick start

Requirements: **Python 3.11+** with [uv](https://docs.astral.sh/uv/), and **Node.js 20.19+**.

```bash
make install        # uv sync + npm ci
cp .env.example .env   # optional; the defaults are safe
make dev            # backend :8000 + frontend :5173, Ctrl+C stops both
```

Open <http://127.0.0.1:5173>. The interactive API docs are at <http://127.0.0.1:8000/docs>
(development only).

To enable NEXUS CORE's LLM mode (Milestone 8), set `ANTHROPIC_API_KEY` in `.env`. The key is read
only by the backend. It is never sent to the browser and is scrubbed from logs.

## Developer commands

| Command | Does |
|---|---|
| `make dev` | Run backend (reload) and frontend together |
| `make backend` / `make frontend` | Run one side only |
| `make test` | pytest (with coverage) + Vitest |
| `make lint` | ruff + ESLint + Prettier check |
| `make typecheck` | mypy `--strict` + `tsc` |
| `make check` | Everything CI runs: lint, typecheck, test, build |
| `make format` | Auto-format both projects |
| `make db-upgrade` | Apply database migrations (the server also does this on start) |
| `make db-revision m="…"` | Autogenerate a new migration from model changes |

## Architecture at a glance

```
React SPA (Vite · TS · Tailwind · Recharts)
   │  HTTP /api/v1  ·  WebSocket /ws/v1   (same origin via proxy)
FastAPI backend — validation · secrets · limits · realtime hub
   ├── SQLite                     (M3)
   ├── OS sensors, read-only      (M5)
   ├── Public Bitcoin APIs        (M6)
   └── LLM provider, optional     (M8)
```

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): full system design, protocols and module
  designs
- [`docs/adr/`](docs/adr/): architecture decision records
- [`SECURITY.md`](SECURITY.md): guarantees, controls and reporting

Data lives in `backend/data/nexus_hash.db` (SQLite) by default. Change it with
`NEXUS_DATABASE_PATH`.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/system/health` | Liveness and readiness with per-subsystem checks |
| `GET /api/v1/system/info` | Version, feature flags (e.g. `llm_configured`), limits, disclaimers |
| `GET /api/v1/system/modules[/{key}]` | Module catalog and delivery status |
| `GET /api/v1/activity` | Persisted activity log, newest first (`limit`, `before_id`, `level`, `category`) |
| `POST /api/v1/hashlab/sha256`, `/header`, `/nonces`, `/competition` | Instant proof-of-work demos (simulated) |
| `POST /api/v1/hashlab/jobs` · `GET /jobs[/{id}]` · `POST /jobs/{id}/cancel` | Mining and benchmark runs (limits plus consent, see `SECURITY.md`) |
| `GET /api/v1/hardware/specs` · `/live` · `/history?hours=` | Capability matrix and machine specs, last 10 min of samples, aggregated history |
| `WS /ws/v1` | Realtime stream: `system`, `activity`, `hashlab` and `hardware` live, more topics per milestone |

Errors always use the envelope
`{"error": {"code", "message", "request_id", "details?"}}`.
