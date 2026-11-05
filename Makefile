# NEXUS HASH AI - developer entrypoints. Run `make help` for the list.
SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

BACKEND  := backend
FRONTEND := frontend

.PHONY: help install backend frontend dev test backend-test frontend-test lint typecheck format build check clean

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install backend (uv) and frontend (npm) dependencies
	cd $(BACKEND) && uv sync --frozen
	cd $(FRONTEND) && npm ci

backend: ## Run the API server with auto-reload on http://127.0.0.1:8000
	cd $(BACKEND) && uv run nexus-hash --reload

frontend: ## Run the Vite dev server on http://127.0.0.1:5173
	cd $(FRONTEND) && npm run dev

dev: ## Run backend and frontend together (Ctrl+C stops both)
	./scripts/dev.sh

test: backend-test frontend-test ## Run all automated tests

backend-test: ## Backend tests with coverage
	cd $(BACKEND) && uv run pytest --cov

frontend-test: ## Frontend unit and integration tests
	cd $(FRONTEND) && npm test

lint: ## Lint and format-check both projects
	cd $(BACKEND) && uv run ruff check . && uv run ruff format --check .
	cd $(FRONTEND) && npm run lint && npm run format:check

typecheck: ## Static type checks (mypy --strict, tsc)
	cd $(BACKEND) && uv run mypy
	cd $(FRONTEND) && npm run typecheck

format: ## Auto-format both projects
	cd $(BACKEND) && uv run ruff format . && uv run ruff check --fix .
	cd $(FRONTEND) && npm run format

build: ## Production build of the frontend
	cd $(FRONTEND) && npm run build

check: lint typecheck test build ## Everything CI runs

clean: ## Remove build artifacts and caches
	rm -rf $(FRONTEND)/dist $(FRONTEND)/coverage $(FRONTEND)/node_modules/.tmp
	find $(BACKEND) -type d \( -name __pycache__ -o -name .pytest_cache -o -name .mypy_cache -o -name .ruff_cache \) -prune -exec rm -rf {} +
	rm -f $(BACKEND)/.coverage
