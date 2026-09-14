# Multi-Agent Task Orchestrator

## Trigger
- A task is large enough that one flat pass tends to lose coherence (a full feature, a multi-file refactor, a full app).
- User says "break this down and handle it properly", "this is a big task".

## What it does
Breaks a large task into explicit roles — planner, implementer, reviewer, tester — with defined handoff contracts between them, so a big task doesn't collapse under one undifferentiated context pass.

## Process
1. **Planner pass**: produce a concrete plan (steps, files touched, order of operations, open questions) before any implementation. Get this confirmed or self-checked for completeness before moving on.
2. **Implementer pass**: execute the plan step by step, strictly following it — flag if reality forces a deviation from the plan rather than silently improvising.
3. **Reviewer pass**: re-read the implementation fresh, as if reviewing someone else's PR — check it actually matches the plan's intent, not just that it runs.
4. **Tester pass**: verify behavior against the original requirement, not just against the plan (the plan itself could have missed something the original ask needed).
5. Each pass hands off a short explicit artifact to the next (the plan, the diff, the review notes, the test results) rather than relying on implicit shared context.

## Output format
- The four artifacts in sequence: plan → diff → review notes → test results, with any deviations between stages called out explicitly.

## Guardrails
- The reviewer pass must be genuinely critical, not a rubber stamp — if implementation deviated from plan without a stated reason, that's a finding, not something to wave through.
