# Dependency-Graph Impact Analyzer

## Trigger
- Before any non-trivial refactor, rename, or signature change.
- User says "what will this break", "what depends on this", "impact of changing X".

## What it does
Statically traces every module, route, test, and caller that touches the function/class being changed, and produces a blast-radius report before any edit is made.

## Process
1. Locate all direct references (imports, calls, inheritance) to the target symbol.
2. Recurse one level further: what calls the callers? Stop recursion at entry points (routes, CLI commands, scheduled jobs, test files).
3. Classify each hit: Direct caller / Test coverage / Public API surface / Dead code (no longer referenced).
4. Flag anything crossing a service/repo boundary (e.g., referenced in a frontend client, a separate microservice, or generated docs).
5. Only after this report is produced, proceed with the requested change.

## Output format
A blast-radius report:
- Direct callers (file:line)
- Tests that exercise this path
- Public/external surface touched (API routes, exported symbols)
- Suggested order of operations (update lowest-risk callers first)

## Guardrails
- Do not proceed to edit code until the report is shown, unless the user explicitly says to skip it.
- If the symbol is exported from a package used outside this repo, say so explicitly — this changes the risk category.
