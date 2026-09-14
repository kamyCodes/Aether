# Config Parity Across Environments Checker

## Trigger
- User says "check config drift", "compare staging and prod config", before a deploy.

## What it does
Compares dev/staging/prod config (feature flags, timeouts, limits, resource sizing) and flags unexplained drift that isn't intentional environment-specific tuning.

## Process
1. Locate config files/values per environment.
2. Diff key by key across environments.
3. For each difference, classify: expected environment-specific (e.g., different DB URLs, different log levels — normal) vs. unexplained/suspicious (e.g., a timeout value that's wildly different with no obvious reason, a feature flag on in staging but silently off in prod with no ticket/comment explaining why).
4. Flag the suspicious category prominently; list the expected category briefly for completeness.

## Output format
- Suspicious drift (needs explanation) vs. expected environment-specific differences.

## Guardrails
- Don't assume a difference is a bug — many are intentional. The goal is surfacing what needs a human explanation, not "fixing" config to be identical everywhere.
