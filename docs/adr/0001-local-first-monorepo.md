# ADR 0001: Local-first monorepo with a FastAPI backend and a React SPA

- **Status:** Accepted (Milestone 1)
- **Date:** 2026-11-05

## Context

NEXUS HASH AI reads local hardware telemetry, runs CPU-bound simulations and holds an LLM API key.
All three are sensitive: telemetry describes the user's machine, simulations consume their compute,
and keys cost money. The spec requires Python/FastAPI/SQLite/Pydantic on the backend,
React/TypeScript/Tailwind/Recharts on the frontend, and no paid infrastructure without approval.

## Decision

- One repository with `backend/` (uv-managed Python package `nexus_hash`) and `frontend/` (Vite
  SPA). Shared tooling lives at the root (`Makefile`, `scripts/dev.sh`, CI).
- **Local-first:** the backend binds to `127.0.0.1` by default. Binding to any other interface
  fails validation unless `NEXUS_ALLOW_REMOTE_ACCESS=true` is set.
- The browser talks to one origin (Vite proxy in development; FastAPI serving the SPA in
  production), so CORS stays a tight allowlist.
- The backend is the only trust boundary: validation, secrets, limits and all outbound calls live
  there.

## Consequences

- Zero-ops for a single user, and no hosting cost.
- Multi-user or remote deployment needs authentication on top (planned as an optional local API
  token in M9). The explicit bind opt-in prevents accidental exposure in the meantime.
- API contract types are mirrored by hand in `frontend/src/types/api.ts`. Generating them from
  OpenAPI is a candidate improvement for M9.
