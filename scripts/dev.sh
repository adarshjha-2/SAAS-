#!/usr/bin/env bash
# Run the NEXUS HASH AI backend (FastAPI :8000) and frontend (Vite :5173)
# together. Ctrl+C stops both. Portable to macOS's bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "error: $1 is required ($2)" >&2; exit 1; }
}
require uv "https://docs.astral.sh/uv/"
require npm "Node.js 20.19+"

[ -d "$ROOT/backend/.venv" ] || (cd "$ROOT/backend" && uv sync --frozen)
[ -d "$ROOT/frontend/node_modules" ] || (cd "$ROOT/frontend" && npm ci)

BACKEND_PID=""
FRONTEND_PID=""
cleanup() {
  trap - INT TERM EXIT
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null || true
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

(cd "$ROOT/backend" && exec uv run nexus-hash --reload) &
BACKEND_PID=$!
(cd "$ROOT/frontend" && exec npm run dev -- --clearScreen false) &
FRONTEND_PID=$!

echo "NEXUS HASH AI  ->  http://127.0.0.1:5173   (API docs: http://127.0.0.1:8000/docs)"

# Exit as soon as either process stops, taking the other down with it.
while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
  sleep 1
done
