# Cross-Repo Context Linker

## Trigger
- Multi-service or multi-repo projects where a change in one repo affects another (e.g., a shared architecture like IRIS with separate modules).
- User says "check how this is used in the other repo/module", "pull context from X".

## What it does
Pulls relevant context (interfaces, shared types, config contracts) from sibling repos/modules without the user manually pasting files in.

## Process
1. Ask for (or locate, if accessible on disk) the path(s) to sibling repos/modules relevant to the current task.
2. Identify the specific interface boundary being touched (shared API contract, message schema, shared config, imported package).
3. Pull only the relevant slice — the shared interface/type definitions and their direct usages — not the whole sibling repo.
4. Cross-check: does the current change stay compatible with what the sibling repo expects? Flag mismatches explicitly.

## Output format
- "Cross-repo contract" summary: what's shared, where it's defined, where it's consumed, and whether this change is compatible.

## Guardrails
- Never modify a sibling repo's files without explicit confirmation — read-only by default across repo boundaries.
