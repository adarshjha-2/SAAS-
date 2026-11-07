# Security Policy — NEXUS HASH AI

NEXUS HASH AI is a local-first research platform. It handles three sensitive things: your
machine's telemetry, your compute and your API keys. This document lists what the platform
guarantees, how each guarantee is enforced, and how to report a problem.

## Non-negotiable guarantees

| The platform never… | Enforcement |
|---|---|
| exposes API keys to the browser | Keys exist only in backend env as `SecretStr`. `/system/info` returns only `llm_configured: bool`. Only `VITE_*` variables reach the bundle, and none are secret. Tested. |
| writes secrets to logs | `SecretRedactionFilter` scrubs configured secret values from every log record. Tested end to end. |
| listens beyond your machine by accident | Loopback bind by default. Any other host fails startup unless `NEXUS_ALLOW_REMOTE_ACCESS=true`. Tested. |
| starts intensive workloads silently | Consent gate plus hard limits plus isolated worker process (ADR 0002, enforced from M4). Nothing CPU-heavy runs at boot. |
| mines on the real Bitcoin network, joins pools, or claims to bypass proof-of-work | HashLab is a labelled simulator. There is no pool or stratum client, and no network submission code. |
| uses cloud compute, spends money or makes purchases | No such integrations exist. LLM calls happen only on explicit user requests. Paid infrastructure requires owner approval. |
| runs hidden processes | All background tasks are named, listed in the app lifespan and cancelled on shutdown. |

## Controls implemented (Milestone 1)

- **Configuration:** typed, validated and immutable settings. Invalid configuration aborts startup
  with a clear message. `.env` is git-ignored, and `.env.example` is validated by a test.
- **Input validation:** Pydantic models on every endpoint and every WebSocket message.
  Discriminated unions reject unknown actions and topics.
- **Error handling:** a uniform error envelope. Internals are never returned: an unhandled
  exception becomes a generic 500 with a request ID, and its details go only to server logs.
  Validation errors do not echo input.
- **HTTP hardening:**
  - `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`
  - strict `Content-Security-Policy` on API responses
  - `Cache-Control: no-store`, COOP/CORP, restrictive `Permissions-Policy`
  - no `Server` header
- **CORS:** explicit allowlist, no credentials, and wildcards rejected by config validation.
- **WebSocket:** `Origin` allowlist (prevents cross-site WebSocket hijacking), connection cap,
  message size cap, text frames only, bounded per-client queues.
- **Resource limits:** request body cap (413), including chunked bodies with no `Content-Length`.
- **Supply chain:** lockfiles (`uv.lock`, `package-lock.json`) and `npm audit` in CI. A transitive
  `minimatch` advisory (GHSA-g3hv-75wg-m249, dev-only lint toolchain) is pinned to the patched
  release via npm `overrides`. Fonts are self-hosted, so no third-party CDN requests are made at
  runtime.

## Controls implemented (Milestone 3)

- **Activity log integrity.** Entries are written only by backend services. The HTTP API is
  read-only, so no client can forge or delete audit entries. Input to the log is length-bounded,
  with a JSON `context` capped at 4 KB.
- **Database errors.** A locked, missing or corrupt database returns a generic 503. Driver messages
  stay in server logs.
- **Data minimisation.** `/system/info` exposes the schema revision and retention policy, never
  filesystem paths. Retention limits how long activity data is kept (30 days or 50,000 entries by
  default).
- **Test isolation.** Every test runs on its own temporary database, so the test suite can never
  read or modify real user data.

## Controls implemented (Milestone 4: HashLab)

- **Explicit consent for intensive work.** Any run allowed to use a CPU core for more than 2 s
  (configurable), and every benchmark, is refused with `403 permission_required` unless that request
  carries `consent: true`. The UI only sends it after an acknowledgement dialog that states the
  impact. Consent is recorded on the run and in the activity log.
- **Hard limits:** at most 32 difficulty bits and 60 s per run (configurable, with validated
  maxima), and one run at a time (409). Unknown request fields are rejected.
- **Isolation.**
  - Work runs in one spawned worker process at reduced priority (`nice 10`), never on the API's
    event loop.
  - Cancellation takes effect within about 0.3 s.
  - The worker is idle (0 CPU) when no run is active. Nothing starts at boot, and runs interrupted
    by a crash are marked failed rather than resumed.
- **No network effect.** Simulated hashes are never submitted anywhere. There is no pool or stratum
  client, and every response is labelled `simulated: true`.
- **Failure containment.** A worker crash fails only that run, with a generic message; details stay
  in the server log. The server stays healthy.

## Controls implemented (Milestone 5: Hardware Intelligence)

- **Read-only, unprivileged monitoring.** It only reads counters and sensor files. It never writes
  to hardware, never needs root, and never generates load. RAPL counters that need root are
  reported as unavailable, not worked around.
- **Measured, visible overhead.** About 0.3 ms per sample, and about 0.3% of a core for the whole
  idle server. The page shows the server process's own CPU and memory use.
- **Truthful readings.** Unavailable metrics are `null` with a stated reason, never zero.
- **Data minimisation and an off switch.** Hardware history is aggregated per minute and kept for 7
  days (configurable). Monitoring can be turned off with `NEXUS_HARDWARE_MONITORING_ENABLED=false`.

## Planned controls

- M6: outbound host allowlist, timeouts and circuit breakers (ADR 0003).
- M8: LLM token budgets, rate limits, grounded prompts, advisory-only agent (ADR 0004).
- M9: API rate limiting, an optional local API token for remote mode, dependency and secret
  scanning in CI, Playwright security smoke tests.

## Reporting a vulnerability

Please do not open a public issue. Email the maintainer (see the repository owner's GitHub
profile) with steps to reproduce, the affected version (`nexus-hash --version`) and the request ID
from any error response. You will get an acknowledgement within 72 hours.
