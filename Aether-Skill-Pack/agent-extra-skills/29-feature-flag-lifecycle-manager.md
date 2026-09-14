# Feature Flag Lifecycle Manager

## Trigger
- Adding a new feature flag, or user says "audit feature flags", "clean up flags".

## What it does
Tracks flags from creation to cleanup: flags ones at 100% rollout for a while that should be deleted, and warns when new code adds a permanent dependency on a supposedly-temporary flag.

## Process
1. Inventory all feature flags referenced in code, plus their current rollout status if that's accessible (config file, flag service reference).
2. Flag any at 100%/fully-enabled status for longer than a reasonable threshold (ask user, default suggestion: 30+ days) as cleanup candidates — the flag check should be removed and the "on" branch made permanent.
3. Flag any flag with zero remaining references in code (fully removed from the codebase but possibly still configured in the flag service) — stale on the service side.
4. When new code adds a flag check, ask whether it's meant to be temporary (rollout flag, should have a removal plan) or permanent (a genuine runtime toggle/kill switch) — treat these differently in the audit.

## Output format
- Cleanup candidates (100% rollout, remove the flag), stale flags (in service, not in code), and flags without a clear temporary/permanent classification.

## Guardrails
- Don't auto-remove a flag and its old-path code without confirmation — flag removal changes runtime behavior and needs explicit sign-off.
