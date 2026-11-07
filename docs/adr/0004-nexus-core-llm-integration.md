# ADR 0004: NEXUS CORE LLM integration

- **Status:** Accepted (Milestone 1; implemented in Milestone 8)
- **Date:** 2026-11-05

## Context

NEXUS CORE must interpret statistics, explain concepts, analyse efficiency, flag unusual changes,
generate reports and suggest safe configuration changes. It may use an LLM only through a secure
backend, and must never expose keys to the frontend.

## Decision

- **Backend-only access.** The key is read from `ANTHROPIC_API_KEY` / `NEXUS_ANTHROPIC_API_KEY`
  into a `SecretStr`. It is never serialised, never sent to the browser (`/system/info` exposes
  only `llm_configured: bool`) and is scrubbed from logs. All of this is tested in M1.
- **Provider abstraction** (`LLMProvider` protocol). Anthropic's Claude API is the first
  implementation; the model is configurable by environment variable and defaults to a current,
  capable Claude model chosen at implementation time.
- **Grounded, analytics-first.** Deterministic analytics (Nexus Intelligence) compute the facts.
  The LLM receives them as clearly delimited data and explains them. External text (API payloads,
  user-supplied content) is never treated as instructions.
- **Advisory only.** The agent has no tools that change state, spend money, start workloads or
  fetch arbitrary URLs. Suggested changes are rendered as proposals the user applies explicitly.
- **Offline mode.** With no key configured, NEXUS CORE answers from analytics and a curated
  knowledge base and clearly states that it is offline. The product is fully usable without paid
  APIs.
- **Budgets:** per-request token caps, per-client rate limits and streamed responses.

## Consequences

- No vendor lock-in, and no key exposure surface in the frontend.
- LLM calls cost money per request. Usage stays user-initiated, with no background or automatic
  calls.
