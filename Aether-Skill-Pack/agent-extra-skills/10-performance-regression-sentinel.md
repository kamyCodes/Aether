# Performance Regression Sentinel

## Trigger
- Changes to hot paths: inference calls, tight loops, DB queries, anything previously identified as performance-sensitive.
- User says "check for perf regressions", "benchmark this change".

## What it does
Benchmarks the affected code path before and after a change and flags if latency/memory crosses a set threshold — especially useful around ML/NLP inference calls.

## Process
1. Identify the function(s)/path(s) affected by the change.
2. If a benchmark harness exists in the repo, use it; otherwise, write a minimal one (timed loop with realistic input sizes, or use the project's existing profiling tool).
3. Run baseline (pre-change) and post-change measurements, at least 3 runs each, report median not just one sample.
4. Compare against a threshold (ask the user for one if not specified; default to flagging anything >15% slower or with materially higher memory).
5. If regression detected, identify the likely cause (extra allocation, N+1 query, added synchronous call, etc.) before suggesting a fix.

## Output format
- Before/after table: metric | baseline | new | % change
- Verdict: pass / regression detected, with suspected cause if regressed.

## Guardrails
- Don't report a regression off a single noisy run — always take a median of multiple runs.
- Distinguish "slower but correct" from "faster but now wrong" — verify output correctness didn't change too.
