# ADR 0006: Persistence — SQLite (WAL) with async SQLAlchemy and auto-applied Alembic migrations

- **Status:** Accepted (Milestone 3, implemented)
- **Date:** 2026-11-05

## Context

The platform needs durable state: an audit-quality activity log now, and telemetry history,
simulation runs, network snapshots and agent conversations later. The spec mandates SQLite. The
app is local-first, single-process and async (FastAPI), and services must publish to the
in-process realtime hub from the event loop thread (`asyncio.Queue` is not thread-safe).

## Decision

- **SQLite in WAL mode**, configured per connection with `synchronous=NORMAL`, `foreign_keys=ON`
  and `busy_timeout=5000`. Readers never block the writer, and short lock contention waits rather
  than failing.
- **Async SQLAlchemy 2.x via `aiosqlite`.** Database calls don't block the event loop, and services
  stay on the loop, so publishing to the hub stays safe. Considered and rejected: synchronous
  sessions in a threadpool, which would publish from worker threads or need hand-offs.
- **Alembic migrations packaged inside `nexus_hash`** and applied programmatically at startup
  (`NEXUS_DB_AUTO_MIGRATE=true`, the default). For a single-user local app this removes a manual
  step that users would forget.
  - With auto-migrate off, an out-of-date schema stops startup with an explicit message; it never
    runs against the wrong schema.
  - Migrations are self-contained snapshots and use batch mode for SQLite `ALTER TABLE`.
  - A test compares models against the migrated schema, so drift fails CI.
- **Each module adds its own tables** in its own migration when it ships. No speculative tables.
- **UTC everywhere.** A `UTCDateTime` column type rejects naive datetimes.

## Consequences

- Zero-ops persistence with a real migration story, and upgrades apply on the next start.
- SQLite allows one writer at a time. That's ample for one user's telemetry and logs, and writes
  are short transactions. A multi-user or remote deployment would need a server database: the
  SQLAlchemy and Alembic layer makes that a configuration and migration change, not a rewrite.
- The activity log is append-only from clients' point of view (a read-only API). Only backend
  services write to it, which keeps it trustworthy as an audit trail.
