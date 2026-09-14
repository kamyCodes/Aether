# Continuous Quality Gate

## Trigger
- Before declaring any task "done" or "complete".
- User says "is this actually ready", "final check before I ship this".

## What it does
Runs a fixed checklist before calling anything complete — tests, lint, types, no console warnings/errors, basic accessibility pass — and reports gate status explicitly rather than declaring completion on vibes.

## Process
1. Run (or check for) each gate: automated tests pass, linter clean, type-checker clean (if typed language), no new console errors/warnings introduced, a basic accessibility check on any new UI (see Accessibility Auditor skill for depth).
2. Report each gate's actual status — pass/fail/not-applicable — don't skip a gate silently just because it's inconvenient to check.
3. If any gate fails, that task is not "done" — say so plainly, even if the core functionality appears to work.
4. Only after all applicable gates pass, or the user explicitly accepts a known gap, report the task as complete.

## Output format
- Gate checklist with explicit pass/fail/N-A per item, then an overall verdict.

## Guardrails
- Never report "done" while silently omitting a failed gate — if something is broken or unchecked, that has to be visible in the final report, not buried.
