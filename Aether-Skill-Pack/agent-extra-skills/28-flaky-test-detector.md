# Flaky Test Detector

## Trigger
- A test fails intermittently, or user says "this test is flaky", "why does this fail randomly".

## What it does
Reruns the suite/test multiple times to isolate intermittent failures, then diagnoses the likely cause instead of just labeling it "flaky" and moving on.

## Process
1. Rerun the suspected test in isolation several times, and also as part of the full suite (some flakiness only appears with shared state from other tests).
2. If it fails intermittently, inspect for common causes: unseeded randomness, real timers/sleeps instead of mocked time, shared mutable state between tests (module-level variables, shared DB/fixtures not reset), real network/async calls without proper awaiting, order-dependence (passes alone, fails in suite or vice versa).
3. Narrow to the specific cause via the pattern of failures (e.g., only fails when run after test X → shared state; only fails under load → timing/race condition).
4. Propose a fix addressing the actual cause (seed the randomness, mock the clock, isolate/reset shared state, properly await async operations) — not just "add a retry" as the default fix.

## Output format
- Diagnosis: suspected cause, evidence from the rerun pattern, proposed fix.

## Guardrails
- Don't default to "just add a retry/increase timeout" — that masks the bug rather than fixing it. Only recommend retries as a last resort for genuinely external flakiness (e.g., a third-party sandbox API), and say so explicitly.
