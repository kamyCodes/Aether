# API Rate-Limit & Backoff Auditor

## Trigger
- Adding a call to an external API, or user says "check retry logic", "will this hit rate limits".

## What it does
Checks external API calls for missing retry/backoff logic, flags calls with no rate-limit handling, and generates an exponential-backoff wrapper matching the target API's documented limits.

## Process
1. Identify all external API calls in the target code and whether each has: retry logic, backoff strategy (fixed vs. exponential), rate-limit-aware handling (respecting `Retry-After` headers or documented limits), and a max-retry cap (to avoid infinite retry loops).
2. Look up (or ask for) the target API's documented rate limits and recommended retry behavior if not already known.
3. For calls missing this handling, generate a wrapper: exponential backoff with jitter, respects `Retry-After` if the API provides it, capped retry count, and distinguishes retryable errors (429, 503, timeouts) from non-retryable ones (400, 401, 404 — don't retry these).

## Output format
- Table: API call location | current handling | gaps | generated wrapper (if needed)

## Guardrails
- Never retry non-idempotent operations (e.g., a POST that creates a resource) without confirming the API is safe to retry (idempotency key support) — flag this risk explicitly rather than wrapping it blindly.
