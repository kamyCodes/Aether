# Prototype-to-Production Hardener

## Trigger
- Taking a fast throwaway prototype toward something real.
- User says "harden this for production", "this was just a quick prototype, make it real".

## What it does
Systematically upgrades a prototype — error handling, input validation, security basics, env/config management — and lists exactly what was hardened and what's still a known shortcut.

## Process
1. Audit the prototype against a production checklist: input validation on all user-supplied data, error handling on all I/O (network, disk, DB), secrets moved out of hardcoded values into env/config, auth/authorization actually enforced (not just present in UI), logging for failures, rate limiting on public endpoints if applicable, and basic handling of concurrent/duplicate requests where relevant.
2. Apply fixes for each gap found.
3. For anything intentionally left as a known shortcut (e.g., "using in-memory storage, will need a real DB before this scales"), state it explicitly rather than letting it pass as production-ready.

## Output format
- Checklist: item | status before | status after | still a known gap (if any)

## Guardrails
- Never silently mark something as hardened when it's only partially addressed (e.g., adding validation to some but not all inputs) — the checklist has to reflect reality precisely, not aspirationally.
