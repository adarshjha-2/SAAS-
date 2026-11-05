# ADR 0002: Workload safety and explicit consent

- **Status:** Accepted (Milestone 1; enforced from Milestone 4)
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
