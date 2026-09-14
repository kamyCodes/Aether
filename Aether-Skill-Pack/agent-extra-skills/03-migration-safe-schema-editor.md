# Migration-Safe Schema Editor

## Trigger
- Any change to an ORM model, SQL table definition, or database schema.
- User says "add a column", "change this model", "update the schema".

## What it does
Diffs the proposed model change against the current schema and generates the matching migration file (Alembic/Prisma/Django/etc., detect from repo) plus a working rollback.

## Process
1. Detect the migration tool in use from the repo (look for alembic/, prisma/schema.prisma, migrations/ folders, etc.). Ask if ambiguous.
2. Diff proposed model vs. current schema: added/removed/renamed columns, type changes, new constraints/indexes.
3. Flag any change that is NOT backward-compatible (dropping a column, tightening a NOT NULL, narrowing a type) and warn about data loss risk before generating anything.
4. Generate the migration file matching the project's existing migration style (naming, structure).
5. Generate the corresponding `down`/rollback migration — never leave this blank.
6. If the change affects an indexed or large table, note the potential lock/performance impact.

## Output format
- Migration file (up + down)
- One-line summary of what changed and whether it's backward-compatible

## Guardrails
- Never auto-apply a destructive migration (dropping columns/tables) without explicit confirmation.
- Always write the rollback, even if trivial.
