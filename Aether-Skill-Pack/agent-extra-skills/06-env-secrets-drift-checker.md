# Env/Secrets Drift Checker

## Trigger
- Before a deploy.
- User says "check my env vars", "why is this failing in prod", "deploy readiness check".

## What it does
Diffs `.env.example` (or equivalent) against what the code actually reads (`os.getenv`, `process.env`, config classes) and against deployment platform env vars if accessible, flagging missing or unused keys before runtime failure.

## Process
1. Scan the codebase for all environment variable reads.
2. Compare against `.env.example`/`.env.sample`: flag variables read in code but missing from the example file, and variables in the example file never read in code (likely stale).
3. If deployment config is available (Render/HF Spaces/etc. config files in repo), compare against that too.
4. Check for obviously placeholder values left in real env files (e.g., `CHANGE_ME`, `your_key_here`) if such a file is accessible.

## Output format
- Missing from example but used in code (will break new setups)
- In example but unused in code (stale, safe to remove)
- Any placeholder values detected

## Guardrails
- Never print actual secret values, only variable names and whether they're set/unset.
- Never commit or output real credentials found during the scan.
