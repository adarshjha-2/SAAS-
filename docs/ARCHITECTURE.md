# NEXUS HASH AI — System Architecture

> Intelligence Beyond Computational Limits.

This document is the technical blueprint for NEXUS HASH AI. It describes what exists today
(Milestone 1) and the designs that later milestones implement. Decisions with lasting
consequences are recorded as ADRs in [`docs/adr/`](adr/).

---

## 1. Product principles

These are engineering constraints, not marketing copy. Each one is enforced in code and covered by tests.

| Principle | What it means in practice |
|---|---|
| **Truthful data** | Simulated, stale, estimated or unavailable data is always labelled as such. The UI never renders placeholder numbers as if they were real, and never shows a stale value as live (see `CommandPage` and its regression test). |
| **Explicit consent** | No CPU/GPU-intensive workload starts without an explicit, per-run user confirmation. No background mining, no hidden processes, no cloud compute, no spending. |
| **Secrets stay server-side** | API keys exist only in the backend's environment. The frontend learns only *whether* a key is configured. Secrets are `SecretStr` and are scrubbed from logs. |
| **Local-first and least exposure** | The API binds to loopback by default. Exposing it to a network requires an explicit opt-in. |
| **Graceful degradation** | Every external dependency (public APIs, hardware sensors, the LLM) can be missing. Its absence is reported as a capability state, never as a crash or a fake value. |
| **No cryptographic shortcuts** | HashLab demonstrates real SHA-256 proof-of-work. There is no claim, anywhere, of bypassing or accelerating Bitcoin's proof-of-work. |

---

## 2. System context

```mermaid
flowchart LR
    user([Researcher / operator])
    subgraph Browser
        spa[React SPA<br/>Vite · TypeScript · Tailwind · Recharts]
    end
    subgraph Backend["FastAPI backend (127.0.0.1:8000)"]
        api[HTTP API /api/v1]
        ws[Realtime hub /ws/v1]
        mods[Domain modules]
        db[(SQLite)]
    end
    os[[OS / hardware<br/>psutil · NVML · RAPL]]
    btc[[Public Bitcoin APIs<br/>mempool.space · blockchain.info]]
    llm[[LLM provider<br/>Anthropic API, optional]]

    user --> spa
    spa -- "JSON over HTTP" --> api
    spa <-- "JSON frames over WebSocket" --> ws
    api --> mods
    ws --- mods
    mods --> db
    mods -- read-only --> os
    mods -- "allowlisted HTTPS, cached" --> btc
    mods -- "server-side key" --> llm
```

* **One origin for the browser.** In development, Vite proxies `/api` and `/ws` to the backend. In
  production (Milestone 10) FastAPI serves the built SPA itself, so CORS stays closed.
* **The backend is the trust boundary.** It validates every input, owns every secret, enforces every
  resource limit, and is the only component that talks to the outside world.

---

## 3. Repository layout

```
.
├── backend/                    Python 3.11+ · FastAPI · Pydantic v2 · uv
│   ├── nexus_hash/
│   │   ├── core/               Platform foundations (no domain logic)
│   │   │   ├── config.py       Typed settings, secret handling, bind policy
│   │   │   ├── errors.py       Error taxonomy + uniform JSON envelope
│   │   │   ├── middleware.py   Request ID, access log, security headers, body limits
│   │   │   ├── logging.py      Structured logs, request correlation, secret redaction
│   │   │   ├── realtime.py     Pub/sub hub, WebSocket protocol models
│   │   │   └── catalog.py      Module registry (status shown in the UI)
│   │   ├── api/                Thin routers: system.py, realtime.py, deps.py
│   │   ├── db/                 Engine (WAL pragmas), UTC column type, Alembic migrations
│   │   ├── modules/            One package per product module (activity/ since M3)
│   │   ├── main.py             create_app() factory + lifespan
│   │   └── __main__.py         `nexus-hash` CLI entrypoint
│   └── tests/                  pytest suite (unit + HTTP/WebSocket integration)
├── frontend/                   React 19 · TypeScript 5.9 · Vite 8 · Tailwind 4
│   └── src/
│       ├── lib/                api client, realtime connection, query client, formatters
│       ├── hooks/              data hooks (TanStack Query)
│       ├── components/         layout shell + UI primitives (design system)
│       ├── pages/              route views
│       ├── config/             navigation / route table
│       ├── types/              API contract types (mirror backend models)
│       └── test/               fakes and fixtures
├── docs/                       architecture, roadmap, ADRs
├── scripts/dev.sh              runs backend + frontend together
├── Makefile                    developer entrypoints (`make help`)
└── .github/workflows/ci.yml    lint · typecheck · test · build · audit
```

---

## 4. Backend architecture

### 4.1 Layers

```
api/ (routers)        validate input, map to/from schemas, no business logic
   │
modules/<x>/service   domain logic, pure and unit-testable, no FastAPI imports
   │            ╲
providers         repositories        adapters to the outside world / SQLite
   │
core/                 config, errors, logging, middleware, realtime hub
```

Rules:

1. A module may import `nexus_hash.core`, but never another module's internals. Cross-module
   flows go through services, or through the realtime hub.
2. Routers stay thin: anything worth testing lives in a service.
3. Every external call goes through a provider class with a timeout and a typed result. That makes
   each provider replaceable with a fake in tests.

### 4.2 Request pipeline

Middleware is pure ASGI (no `BaseHTTPMiddleware`), so it adds no buffering and passes WebSocket
traffic straight through. Order from outermost to innermost:

| Layer | Responsibility |
|---|---|
| `SecurityHeadersMiddleware` | `nosniff`, `X-Frame-Options: DENY`, strict CSP for JSON, `no-store`, COOP/CORP, `Permissions-Policy` |
| `CORSMiddleware` | Explicit origin allowlist, no credentials, no wildcard |
| `RequestContextMiddleware` | Accepts or generates `X-Request-ID`, adds `Server-Timing`, writes a correlated access log, turns any unhandled exception into a generic 500 envelope |
| `BodySizeLimitMiddleware` | Rejects bodies over the limit with 413, including chunked uploads with no `Content-Length` |
| Exception handlers | `AppError` subclasses, HTTP errors and validation errors all map to the envelope |

### 4.3 Error envelope

Every non-2xx response has the same shape:

```json
{ "error": { "code": "permission_required", "message": "…", "request_id": "…", "details": [] } }
```

Codes come from a fixed enum (`ErrorCode`). Validation details are sanitised to `loc` / `msg` /
`type`, so user input is never echoed back. Internal exception text is logged and never returned.

Domain errors raise typed exceptions: `NotFoundError`, `ConflictError`, `PermissionRequiredError`,
`ResourceLimitError` and `UpstreamUnavailableError`.

### 4.4 Configuration

`Settings` (pydantic-settings) reads `NEXUS_*` environment variables and optional `.env` files.
Values are validated at startup and the settings object is immutable afterwards.

* An invalid config stops the server with a readable message (exit code 2, no traceback).
* A non-loopback bind requires `NEXUS_ALLOW_REMOTE_ACCESS=true`.
* A wildcard CORS origin is rejected.
* A test asserts that `.env.example` is valid, equals the code defaults, and documents every setting.

### 4.5 Realtime protocol (`/ws/v1`)

The browser opens one multiplexed connection and subscribes to topics:

| Direction | Message |
|---|---|
| client → server | `{"action":"subscribe","topics":["system","network"]}` · `{"action":"unsubscribe",…}` · `{"action":"ping","id":"p7"}` |
| server → client | `welcome` · `ack` · `pong {id}` · `error` · `event {topic, type, ts, data}` |

The optional ping `id` (at most 64 characters from `[A-Za-z0-9_-]`) is echoed in the pong, so the
client measures round-trip latency exactly, with no FIFO guessing and no clock-skew assumptions.

| Topic | Publisher | Milestone |
|---|---|---|
| `system` | heartbeat: uptime, version, connection count | **1 (live)** |
| `activity` | persisted activity log entries | **3 (live)** |
| `hashlab` | simulation run progress and results | **4 (live)** |
| `hardware` | hardware samples (every 2 s) | **5 (live)** |
| `network` | network snapshots | 6 |
| `intelligence` | recommendations and anomalies | 8 |

Guarantees:

* **Bounded memory.** Each client has a bounded outbound queue that drops the oldest message when
  full (drops are counted).
* **Ordered writes.** A single writer task per socket means frames are never interleaved.
* **Immediate state.** On subscribe, a client gets the current state of each topic. Live-state
  topics have a *snapshot provider* that computes a fresh value, so a stale count is never replayed.
* **Origin checks.** Browsers don't apply CORS to WebSockets, so `Origin` is checked against the
  allowlist to prevent cross-site WebSocket hijacking.
* **Limits.** Connection cap (close code 1013), message size cap (close code 1009), and text frames
  only.

The frontend's `RealtimeConnection` is framework-agnostic: it reconnects with exponential backoff
and jitter (1 s → 30 s), and React binds to it through `useSyncExternalStore`.

---

## 4b. Frontend architecture

### State and data flow

| Concern | Mechanism |
|---|---|
| Request/response data (health, info, catalog; module APIs later) | TanStack Query hooks in `hooks/`. Retries only transient failures (offline, timeout, 5xx). |
| Push data | One `RealtimeConnection` per tab, exposed via `useRealtime()`. Latest event per topic, plus ping round-trip history. |
| Client-side telemetry | `SampleStore` ring buffers (e.g. `apiLatency`), and `resampleSeries()` to align independently-timed series onto shared buckets. |
| Activity log | `ActivityLog` store (bounded, newest first). `useActivityRecorder()` records real, observed transitions: stream connect/drop/restore and backend online/degraded/unreachable/recovered. In M3, server-persisted entries join with `source: "server"`. |
| App-wide providers | `AppProviders`, shared by `main.tsx` and tests (each store is injectable). |

All stores are framework-agnostic classes with `subscribe` / `getSnapshot` methods. React binds
through `useSyncExternalStore`, and tests drive them directly.

### Truthfulness rules (enforced and tested)

* **No stale-as-live.** React Query keeps the last data after a failed refetch, and the stream keeps
  its last event after a drop. So every "live" figure is gated on *current* health. During an
  outage, tiles read OFFLINE / RECONNECTING / "Unavailable" (regression test in `App.test.tsx`).
* **Gaps stay gaps.** `resampleSeries` reports a series' latest measurement only while it is at most
  `maxAgeMs` old; otherwise the value is `null` and the chart draws a break. It never interpolates
  across an outage.
* **Provenance on every figure.** `ProvenanceBadge`: Live · This session · Simulated · Estimate ·
  Stale · Offline · Planned.
* **No placeholder metrics.** A module without data shows an `EmptyState` naming the milestone that
  delivers it.

### Design system (`components/ui`, `components/charts`)

| Component | Purpose |
|---|---|
| `Panel` | The base surface (title, eyebrow, actions) |
| `StatTile` + `Sparkline` | Headline metric. A 12-point trend in recessive ink, with the latest segment in the accent. |
| `TimeSeriesChart` | Recharts area/line chart following the data-viz conventions below, with a built-in table view |
| `ProvenanceBadge`, `StatusPill` / `StatusDot` | Data origin and status: text plus colour, never colour alone |
| `EmptyState` | Explains what will appear and why it isn't there yet |
| `SegmentedControl` | Mutually exclusive views (Chart / Table) |
| `ConsentDialog` | Explicit per-action permission for intensive workloads (ADR 0002). Confirm stays disabled until acknowledged. Focus trap, Escape to cancel, focus restored on close. |

### Data-visualisation conventions

* **Series palette** (fixed order, never cycled): `--color-series-1..4` =
  `#00a3bb` · `#e3611c` · `#9085e9` · `#d55181`.
  - Validated with the palette checker against the dark panel surface `#0a0d14`: lightness band,
    chroma floor, adjacent-pair CVD separation (worst ΔE 16.0), normal-vision floor and ≥ 3:1
    contrast all pass.
  - The neon brand accents (`#00e1ff`, `#ff6a13`) failed the lightness band for data marks, so they
    stay UI chrome only.
  - Status colours (ok / warn / fault) are reserved and never used as series colours.
* **Marks and axes.** One y-axis per chart, never dual-axis. 2 px lines with a 10% area wash, a
  solid hairline grid, and end markers with a 2 px surface ring. Clean y-ticks come from
  `niceTicks` (1 / 2 / 2.5 / 5 × 10ⁿ).
* **Reading values.** A legend is shown for two or more series and carries each series' latest
  value. A crosshair tooltip lists every series at the hovered time, value first. A table view twin
  means no value is reachable only by hovering.
* **Text colour.** Text always uses ink tokens. Series identity comes from a line key beside the
  text.

### Performance

Routes are code-split with React Router `lazy`. Recharts ships only in the dashboard chunk (about
113 KB gzipped), and module pages load a chunk of about 1 KB.

---

## 5. Module designs

Status values come from `core/catalog.py`. Designs below are the plan; each milestone refines its
own section when it lands.

### 5.1 HashLab: proof-of-work simulator (M4, **online**)

Code lives in `nexus_hash/modules/hashlab/`:

| File | Contents |
|---|---|
| `pow.py` | Primitives |
| `worker.py` | Search code that runs in the subprocess |
| `competition.py` | Poisson competition model |
| `jobs.py` | Job manager |
| `service.py` | Instant demos |
| `router.py` | HTTP API |

**Primitives (`pow.py`) are verified against the real chain.**

* The 80-byte header serialisation uses little-endian integers, a signed `int32` version, and hashes
  byte-reversed from their display form.
* Hashing is double SHA-256. The compact `bits` field converts to a target and back, following
  Bitcoin Core's rules: negative, zero-mantissa, zero and overflowing targets are rejected.
* The genesis block and block 1 hash to their published block hashes, which proves the
  implementation is real.

**Instant demos** (synchronous, bounded by input size):

| Endpoint | What it does |
|---|---|
| `POST /hashlab/sha256` | Hash text or hex, with the avalanche effect of flipping one bit |
| `POST /hashlab/header` | Serialise a header, hash it, and check it against its target and difficulty |
| `POST /hashlab/nonces` | Try at most 64 nonces |
| `GET /hashlab/presets` | Real block headers to load |

**Mining jobs** (`POST /hashlab/jobs`):

* **Educational difficulty.** A hash passes when it has *at least N leading zero bits*, so the
  expected work is 2^N attempts. A `benchmark` job uses an unreachable target and simply measures
  hash rate.
* **Execution.**
  - One spawned worker process (`ProcessPoolExecutor`, spawn context, `os.nice(10)`).
  - The search runs in adaptive chunks of about 0.25 s. Between chunks, the server checks for
    cancellation and the wall-clock deadline and publishes progress on the `hashlab` topic.
  - Measured: Stop takes effect in about 0.3 s, and the worker uses 0 CPU while idle.
* **Midstate.** The first 64 header bytes never change between nonces, so their SHA-256 compression
  is computed once and copied. This is the standard technique all miners use. Every candidate is
  still fully double-hashed, and a test proves the results match plain hashing.
* **Measured rate.** This pure-Python reference reaches about 1.0–1.3 MH/s on one core. That's
  roughly 58 minutes for a single block at Bitcoin's minimum difficulty (2³² hashes), and the UI
  shows this comparison.
* **Lifecycle.**
  - States: `queued → running → succeeded | exhausted | timed_out | cancelled | failed`.
  - Every state change is persisted in `simulation_runs` (migration `0002`) and logged in the
    activity log as user-initiated.
  - Runs left unfinished by a crash are marked `failed` ("interrupted") at the next start.
  - Shutdown cancels an active run and records it.

**Safety:** ADR 0002 is enforced. See the admission table below and `SECURITY.md`.

**Competition** (`POST /hashlab/competition`) is pure math in simulated time:

* Each miner is a Poisson process with rate = its hash rate ÷ 2^bits. Inter-block times are
  exponential, and winners are drawn in proportion to hash rate.
* Results are reproducible with a seed, and statistical tests check them against theory: shares
  within 5σ of the binomial expectation, and mean block time converging to its expected value.

**Labelling:** every response carries `simulated: true`. The page shows a "Simulation only" notice
and Simulated badges, and the dashboard's Mining simulation panel streams the live run.

| Admission check | Result when it fails |
|---|---|
| `difficulty_bits` > `NEXUS_HASHLAB_MAX_DIFFICULTY_BITS` (default 32) | 422 `resource_limit_exceeded` |
| `max_seconds` > `NEXUS_HASHLAB_MAX_JOB_SECONDS` (default 60) | 422 `resource_limit_exceeded` |
| Benchmark, or `max_seconds` > `NEXUS_HASHLAB_CONSENT_THRESHOLD_SECONDS` (default 2), without `consent: true` | 403 `permission_required` (UI opens the consent dialog) |
| Another run already active | 409 `conflict` |
| Unknown request fields | 422 `validation_error` |

### 5.2 Hardware Intelligence (M5, **online**)

Code lives in `nexus_hash/modules/hardware/`:

| File | Contents |
|---|---|
| `probe.py` | Sources |
| `service.py` | Monitor |
| `models.py` | Aggregated history (migration `0003`) |
| `router.py` | Read-only API |

**Sources, each detected once at startup and each able to explain its absence:**

| Metric | Source | When unavailable |
|---|---|---|
| CPU (total and per core), frequency, load average, memory, swap | `psutil`, `os.getloadavg` | "No swap space is configured", … |
| Temperatures | `psutil.sensors_temperatures()` (prefers CPU sensors, drops implausible readings) | "No temperature sensors are exposed; virtual machines usually hide them" |
| NVIDIA GPU utilisation, memory, temperature, power | NVML (`nvidia-ml-py`), each field optional per card | "No NVIDIA driver (NVML library) found on this machine" |
| CPU package power | Intel RAPL energy counters (`/sys/class/powercap`), with counter wraparound handled | "No RAPL power interface…" / "not readable without root" |
| Container memory limit | cgroup v2 `memory.max` or v1 `limit_in_bytes`, when lower than physical memory | (omitted) |

**The capability matrix** (`GET /hardware/specs`) lists every metric as
`{supported, source, reason}`. Samples carry `null` for anything unsupported, never `0`, and tests
enforce that samples agree with the matrix. On the development VM, CPU, frequency, load and memory
are available; swap, temperatures, GPU and power are not, each with its reason.

**Monitor:**

* A sample every `NEXUS_HARDWARE_SAMPLE_SECONDS` (2 s). It is read in a worker thread so sensor
  file reads never block the event loop.
* Samples go into a 10-minute in-memory ring (`GET /hardware/live`) and are streamed on the
  `hardware` topic. Clients receive every sample through `onEvent`.
* Every `NEXUS_HARDWARE_PERSIST_SECONDS` (60 s), the window is aggregated into one
  `hardware_samples` row: CPU average and max, memory average, load, max temperature, average power
  and average GPU utilisation, with unsupported metrics stored as null.
* Rows older than `NEXUS_HARDWARE_RETENTION_DAYS` (7) are deleted on each write. The partial window
  is flushed on shutdown.
* `GET /hardware/history?hours=` serves the aggregated rows. The UI inserts gaps where the server
  was not running.

**Behaviour:**

* **Start-up audit.** One activity entry lists what is measurable here and why the rest isn't.
* **Failure handling.** A failing sample is logged, with a rate limit on the logging, and skipped.
  When monitoring is disabled, the endpoints answer 503 with the setting's name.
* **Overhead, measured.** One sample takes about 0.3 ms. With monitoring, heartbeat and idle
  sockets, the whole server process uses about 0.3% of one core at idle. The page shows the server
  process's own CPU and memory, so the overhead is visible.
* **Cross-checked.** During a HashLab benchmark, the monitor independently showed one core near
  80% and overall CPU rising by about one core's share.
* **Safety.** Monitoring is read-only: no load, no privileged access, nothing written to hardware.

### 5.3 Bitcoin Network Intelligence (M6)

* **Providers in priority order:**
  1. mempool.space: height, difficulty, adjustment, hash rate, mempool, fees, price
  2. blockchain.info: fallback
  3. CoinGecko: last-resort price only (it returned HTTP 429 from this environment)
* **Resilience.** Per-endpoint TTL caching (about 15–60 s), request timeouts and a circuit breaker.
  On failure the last good value is served with `stale: true`. Every value carries `as_of` and
  `source`, and the UI shows freshness.
* **Derived values are labelled as derived.** Block subsidy comes from height (halving every 210,000
  blocks; 3.125 BTC since block 840,000). Implied hash rate is `difficulty × 2³² / 600`.
* **Egress.** Outbound HTTP is restricted to an allowlist of these hosts.

### 5.4 Profitability Intelligence (M7)

* **Inputs** (validated ranges): hash rate, power draw, electricity price, hardware cost, pool fee,
  uptime, and optionally horizon, difficulty growth and BTC price scenarios.
* **Core model:** expected BTC per day = (your hash rate / network hash rate) × 144 × (subsidy +
  average fees) × (1 − pool fee). Costs are energy (kW × 24 × price) plus amortised hardware.
* **Uncertainty is first-class:**
  - low / base / high scenarios for difficulty growth and price
  - Poisson variance for solo mining vs pool smoothing
  - a sensitivity table and a break-even horizon, which may be "never"
* **Output** is always labelled *estimate*. It carries the full assumption set and the network data
  timestamp, and never says "guaranteed".

### 5.5 Nexus Intelligence: analytics engine (M8)

Deterministic, explainable analytics come first, and the LLM only narrates them:

* efficiency metrics (J/TH, hashes per watt, thermal headroom)
* inefficiency rules with evidence and severity
* anomaly detection on telemetry (EWMA and z-score)
* strategy comparison that reuses the profitability engine

Every recommendation cites the data it was derived from.

### 5.6 NEXUS CORE: AI agent (M8)

* **Backend-only LLM access** behind a provider interface. Anthropic's API is the first provider,
  with the model configurable via env. The key never leaves the server.
* **Grounding.** The backend assembles context from module services (hardware snapshot, network
  snapshot, simulation results, analytics findings) and passes it to the model as clearly delimited
  *data*. External content is never treated as instructions.
* **Advisory only.** The agent explains, analyses, reports and suggests. It cannot start workloads,
  change configuration, spend money or call arbitrary URLs. Any suggested action needs a separate
  user confirmation in the UI.
* **Offline mode.** Without an API key, NEXUS CORE answers from deterministic analytics plus a
  curated knowledge base (SHA-256, difficulty, halving, J/TH and so on), and says it is in offline
  mode.
* **Budgets.** Per-request token caps, rate limiting and streamed responses.

### 5.7 Nexus Command: dashboard (M2, **online**)

The dashboard composes live platform state into one command view:

* **Status tiles:**
  - Backend health
  - Uptime (interpolated locally between heartbeats)
  - Realtime link: measured round-trip, sparkline, connection count
  - Modules online
  - NEXUS CORE LLM mode
* **Platform telemetry:** latency between this browser and the backend over the last 10 minutes.
  WebSocket ping/pong runs every 5 s and API health checks every 10 s, resampled into 5 s buckets.
* **Activity log:** this session's observed events.
* **Module intelligence:** reserved panels for Hardware (M5), Mining simulation (M4), Bitcoin
  network (M6) and AI recommendations (M8). Each shows an honest empty state until its module ships
  and then binds to that module's realtime topic.
* **Roadmap, safety guarantees and resource limits.**

Each panel owns its loading, empty, stale and error states.

---

## 6. Data model and persistence (M3)

See [ADR 0006](adr/0006-persistence-sqlite-alembic.md).

* **Engine.** SQLite through SQLAlchemy 2.x async, using `aiosqlite`, which keeps the event loop
  free and lets services publish to the realtime hub safely. Every connection sets
  `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON` and `busy_timeout=5000`.
* **Migrations.**
  - Alembic scripts ship inside the package (`nexus_hash/db/migrations`) and are applied
    programmatically at startup. With `NEXUS_DB_AUTO_MIGRATE=false`, an outdated schema stops
    startup with a clear message instead.
  - Migrations are self-contained snapshots: they never import app models.
  - A test compares the models against the migrated schema (autogenerate diff), so schema drift
    fails CI.
* **Time.** `UTCDateTime` stores naive UTC and returns aware UTC. Naive input raises an error
  instead of being guessed at.
* **Failure modes.**
  - `/health` runs `SELECT 1` with a 2 s timeout.
  - SQLAlchemy `OperationalError` (locked, missing or corrupt database) becomes a 503 envelope;
    driver details stay in the logs.
  - A failing retention run is logged and retried, never fatal.
* **Isolation in tests.** Every test gets its own temporary database file, including settings
  built from the environment.

### Activity log (implemented)

| Column | Notes |
|---|---|
| `id` | Integer PK, used for keyset pagination (`before_id`) |
| `ts` | UTC timestamp |
| `level` | `info` · `success` · `warning` · `error` (CHECK constraint) |
| `category` | `system` · `database` · `hashlab` · `hardware` · `network` · `profitability` · `intelligence` · `core` (CHECK) |
| `actor` | `system` or `user` (an action the user initiated, e.g. a consented job) (CHECK) |
| `message` / `detail` | ≤ 500 / ≤ 2,000 characters |
| `context` | Optional JSON, ≤ 4 KB, for structured references such as job IDs |

Indexes cover `ts`, `(category, id)` and `(level, id)`.

* **Writers.** Entries are written **only by backend services** (`ActivityService.record`), which
  persist each entry and then publish it on the `activity` topic. The HTTP API is read-only:
  `GET /api/v1/activity?limit&before_id&level&category`.
* **Real events only.** In M3 that means server start and stop, schema migrations, and retention
  runs. Each later module records its own: jobs started or finished, consent granted, provider
  outages.
* **Retention.** A background job deletes entries older than `NEXUS_ACTIVITY_RETENTION_DAYS`, then
  trims to `NEXUS_ACTIVITY_MAX_ENTRIES`, and records what it removed.
* **Frontend.** The dashboard feed merges server entries with this tab's session observations,
  deduplicated by server ID. It receives every live entry through `RealtimeConnection.onEvent`, so a
  burst between renders isn't dropped, and it backfills from the API after a reconnect. The
  `/activity` page adds filters and "load older" pagination.

### Hardware history (implemented, M5)

`hardware_samples` (migration `0003`) stores one aggregated row per window: `ts`,
`window_seconds`, `samples`, `cpu_avg`, `cpu_max`, `memory_percent_avg`, and nullable `load1_avg`,
`temperature_max_c`, `power_avg_w` and `gpu_utilization_avg`. It is indexed on `ts`, with
retention by age.

### Simulation runs (implemented, M4)

`simulation_runs` (migration `0002`) records one row per HashLab run: parameters, consent,
status, attempts, rate, best and found hashes, and timestamps.

### Planned tables (added by the milestone that needs them)

| Table | Purpose |
|---|---|
| `network_snapshots` | Network values plus source, `as_of` and stale flag |
| `simulation_runs` | HashLab job parameters, limits, consent flag, results, duration |
| `profitability_scenarios` | Saved calculator inputs plus assumption set |
| `agent_conversations` / `agent_messages` | NEXUS CORE history (opt-in retention) |
| `reports` | Generated reports (markdown) with provenance |

---

## 7. Security model (summary)

The full policy is in [`SECURITY.md`](../SECURITY.md). Controls implemented in M1, all tested:

* loopback bind by default
* validated, immutable configuration
* `SecretStr` secrets and log redaction
* strict security headers, CORS allowlist and WebSocket origin checks
* body and WebSocket size limits and a connection cap
* sanitised error responses with request IDs
* no secrets in the frontend bundle (only `VITE_*` variables are bundled, and none are secret)

---

## 8. Quality strategy

| Layer | Tooling | What is covered |
|---|---|---|
| Backend static | ruff (incl. bandit rules), mypy `--strict` | Style, bugs, security lint, types |
| Backend tests | pytest + TestClient, coverage | Config policy, error envelope, middleware, WebSocket protocol, hub, logging, CLI |
| Frontend static | ESLint (type-aware), tsc strict, Prettier | Types, hooks rules, formatting |
| Frontend tests | Vitest + Testing Library + fakes | API client, reconnect logic, full-app rendering incl. offline / degraded / stale states |
| E2E smoke | Playwright (run manually in M1; committed to the repo in M9) | Real browser against real servers, incl. kill/restart recovery |
| CI | GitHub Actions | All of the above on every PR, plus `npm audit` of runtime deps |

---

## 9. Deployment model

* **Development:** `make dev` runs uvicorn with reload on :8000 and Vite on :5173 (proxied).
* **Production (M10):** a single process where FastAPI serves the built SPA plus the API. An
  optional Docker image runs as non-root, read-only, with a SQLite volume. There is no paid
  infrastructure, and any hosting decision will be put to the project owner for approval.

---

## 10. Technology choices

| Concern | Choice | Why |
|---|---|---|
| API | FastAPI 0.16x on Starlette 1.x | Async, typed, OpenAPI for free |
| Validation | Pydantic v2 | Fast, strict, shared request/response contracts |
| Python tooling | uv + lockfile, ruff, mypy | Reproducible, fast |
| Persistence | SQLite (WAL) | Zero-ops, local-first, enough for single-user telemetry |
| Frontend | React 19, TypeScript 5.9, Vite 8 | TS pinned to 5.9 because typescript-eslint does not support TS 7 yet |
| Styling | Tailwind CSS 4 with `@theme` design tokens | Tokens in CSS, no runtime cost |
| Data fetching | TanStack Query 5 | Caching, polling, retry policy |
| Charts | Recharts 3 | Required by spec; composable |
| Fonts | Self-hosted via @fontsource | No third-party CDN requests (privacy, offline use) |
| Realtime | Native WebSocket | Bidirectional, one connection per tab |
