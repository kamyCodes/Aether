# Dead Code & Unused Export Finder

## Trigger
- User says "find dead code", "clean up unused exports", periodic codebase hygiene pass.

## What it does
Traces the full import graph across the codebase to find exported functions/components/routes that nothing references anymore — a whole-codebase audit, distinct from pre-change impact analysis.

## Process
1. Build the import graph: every export and every place it's imported.
2. Flag exports with zero importers anywhere in the codebase (excluding intentional public package entry points — check the package's main/index exports separately).
3. Distinguish "definitely dead" (no imports, not re-exported, not used via dynamic/string-based imports) from "possibly dynamic" (referenced only via string concatenation, config-driven loading, or reflection) — flag the latter as needs-manual-check rather than deleting it.
4. Group findings by module/folder so cleanup can be reviewed in logical batches, not as one giant unrelated diff.

## Output format
- Definitely-dead list (safe to remove) vs. possibly-dynamic list (needs manual confirmation), grouped by folder.

## Guardrails
- Never delete anything in this pass — report only. Deletion is a separate, explicitly confirmed step.
- Treat anything exported from a package's public entry point as intentionally public, not dead, even with zero internal usages.
