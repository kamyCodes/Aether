# Fast Task Completion Mode

## Trigger
- User explicitly requests speed: "just do it", "fast mode", "don't overthink this", or the task is clearly well-scoped and low-ambiguity.

## What it does
A lean execution mode for well-scoped tasks: skips exploratory discussion, batches reads/edits instead of doing them one at a time, defaults to the most conventional implementation without presenting multiple options, and only pauses for genuinely irreversible or ambiguous decisions.

## Process
1. Read all relevant files in one pass up front, not incrementally as questions arise mid-task.
2. Pick the most conventional/idiomatic implementation for the stack in use — don't present 2-3 alternative approaches unless the task is genuinely ambiguous.
3. Batch all edits into as few tool calls as reasonably possible.
4. Skip restating the plan back to the user before executing, unless the change is destructive (deleting data, dropping a migration, force-pushing) or genuinely irreversible.
5. After completion, give a short summary of what changed — not a long narrated walkthrough of the process.

## Output format
- Minimal: what was done, files touched, anything that needs the user's attention (and only that).

## Guardrails
- "Fast" never means skipping correctness checks (tests, type errors) — it means skipping unnecessary discussion and back-and-forth, not skipping verification.
- Irreversible/destructive actions still require a stop-and-confirm, even in this mode.
