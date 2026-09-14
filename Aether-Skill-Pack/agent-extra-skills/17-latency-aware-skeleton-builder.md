# Latency-Aware UI Skeleton Builder

## Trigger
- Building a loading state for a component backed by a real API call.
- User says "add a loading state", "this loading feels off".

## What it does
Generates skeleton/shimmer states sized to the actual measured latency of the underlying API call, instead of a generic spinner regardless of wait time.

## Process
1. Determine (or ask for) the real p50/p95 latency of the backing API call.
2. If latency is very low (<300ms), recommend no loading state at all (avoid flicker) or a very brief fade.
3. If moderate (300ms-2s), generate a skeleton matching the actual shape/layout of the loaded content (not a generic box).
4. If long (>2s), generate a skeleton plus a progressive indicator or informative message, since a static skeleton for multiple seconds reads as broken.
5. Match shimmer/skeleton styling to existing design tokens.

## Output format
- Skeleton component code, with a one-line note on which latency bracket it was tuned for and why.

## Guardrails
- Don't default to a spinner+skeleton combo just to cover all cases — pick the right pattern for the actual measured latency.
