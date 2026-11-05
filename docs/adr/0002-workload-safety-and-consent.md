# ADR 0002: Workload safety and explicit consent

- **Status:** Accepted (Milestone 1); **implemented and enforced in Milestone 4**
- **Date:** 2026-11-05

## Context

HashLab runs real SHA-256 proof-of-work, which can saturate CPU cores. The spec forbids intensive
workloads without explicit permission, hidden processes, unauthorized cloud compute and automatic
spending. Users must also never mistake simulation for real mining.

## Decision

1. **Isolation.** Simulation jobs run in a dedicated worker process (`ProcessPoolExecutor`), never
   on the API event loop.
2. **Hard server-side limits** (configurable, with validated maxima): difficulty bits, attempts per
   job, wall-clock seconds, concurrent jobs (default 1). Requests over a limit fail with
   `resource_limit_exceeded` (HTTP 422).
3. **Consent gate.** Sustained or benchmark workloads require `consent: true` in the request, which
   the UI sends only after a confirmation dialog that states the expected CPU impact. Without it
   the API returns `permission_required` (HTTP 403). Each consented run is written to the activity
   log.
4. **No background work.** Nothing starts at boot except lightweight heartbeats and read-only
   samplers. Every job is user-initiated, visible on the `hashlab` topic and cancellable.
5. **Labelling.** Every simulation response carries `simulated: true`, and the UI badges results
   "SIMULATED — not Bitcoin network mining". Simulated hashes are never submitted to the network or
   to any pool.
6. **Educational competition** uses a Poisson process in simulated time, not CPU burn.

## Consequences

- Users can explore proof-of-work safely, with predictable resource use.
- The error taxonomy (`PermissionRequiredError`, `ResourceLimitError`) already exists in M1 and is
  covered by tests, so M4 adds no new failure modes to the API contract.

## Implementation notes (Milestone 4)

- **"Intensive" is defined concretely:** any run allowed to use one CPU core for longer than
  `NEXUS_HASHLAB_CONSENT_THRESHOLD_SECONDS` (default 2 s), and every benchmark. Short runs below the
  threshold start without a dialog. They are still capped, logged and visible.
- **Consent is per request** (`consent: true`). It is recorded on the run and in its activity entry
  ("Explicit consent given to use one CPU core for up to N s"). The UI asks *before* sending, and
  also opens the dialog if the server answers `permission_required`.
- **Isolation:** one spawned worker process at `nice 10`. The search runs in about 0.25 s chunks, so
  cancellation and the deadline are enforced between chunks without shared state. Measured: stop in
  about 0.3 s, and 0 CPU ticks after stopping.
- **Limits:** difficulty is capped at 32 bits and runs at 60 s by default. One run at a time.
- **Recovery:** runs left unfinished by a crash are marked failed on the next start. Nothing resumes
  silently.

