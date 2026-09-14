# Secrets/Credential Leak Scanner

## Trigger
- Before any git push/commit.
- User says "check for leaked secrets", "scan for exposed keys".

## What it does
Scans working diffs AND git history (not just `.env` files) for hardcoded API keys, tokens, and credentials, matching known key-format patterns (AWS, Stripe, OpenAI, GitHub, JWTs, etc.) before a push.

## Process
1. Scan the current diff/staged changes for strings matching known credential formats (prefix patterns like `sk-`, `AKIA`, `ghp_`, `xox[baprs]-`, generic high-entropy strings assigned to variables named `key`/`secret`/`token`/`password`).
2. If asked to check history (not just the current diff), scan recent commit history for the same patterns — flag that a found-in-history secret must be rotated, not just removed, since it's still in git history.
3. Classify findings by confidence: exact known-format match (high) vs. high-entropy string in a suspicious variable name (medium, could be a false positive).
4. For each finding, state exactly where it is and what to do: remove + rotate the credential + add to `.gitignore`/secret manager.

## Output format
- Findings table: file:line | pattern matched | confidence | required action

## Guardrails
- Never print the full secret value in output — truncate/mask it (e.g., `sk-ab12...****`).
- A secret found in git history is not fixed by deleting it from the current file — always say it needs rotation.
