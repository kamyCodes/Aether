# Doc-Sync Skill

## Trigger
- Any change to a function/method signature, public API, or exported type.
- User says "update the docs", "keep docs in sync".

## What it does
Detects signature/behavior changes and updates the corresponding README section, docstring, and API reference in the same change, so docs don't silently rot.

## Process
1. Identify what changed: parameter added/removed/renamed, return type changed, behavior/side-effects changed.
2. Update the docstring/comment directly above the function to match.
3. Search the README and any /docs files for references to this function/endpoint (by name) and update matching examples.
4. If the change is breaking, add a short "Migration" note where docs are updated.

## Output format
- Diff-style summary: which doc locations were updated and why.

## Guardrails
- Don't rewrite unrelated doc sections — touch only what the code change affects.
- If a doc reference can't be confidently located (ambiguous match), flag it for manual review instead of guessing.
