# Contract-First API Scaffolder

## Trigger
- User provides an OpenAPI spec, GraphQL schema, or a plain-language description of an API endpoint/resource.
- User says things like "scaffold this endpoint", "generate the API for X", "add a CRUD resource for Y".

## What it does
Generates backend route handlers + validation models AND the matching frontend client types/hooks in a single pass, so the two never drift out of sync.

## Process
1. If given a spec (OpenAPI/GraphQL), parse it. If given a plain description, first draft a minimal schema (fields, types, required/optional) and show it to the user before generating code — do not guess silently on field types.
2. Generate backend: route/handler, request/response validation models, and a stub for business logic (clearly marked `// TODO: implement`).
3. Generate frontend: matching TypeScript interfaces/types and a typed client function (fetch wrapper or hook) for the same endpoint.
4. Generate one example request/response pair as a comment or fixture, for docs and testing.
5. Point out any field-level mismatches you had to resolve (e.g., snake_case backend vs camelCase frontend) and how you handled them.

## Output format
- Backend file(s), frontend file(s), and a short "contract summary" table: field name | type | required | notes.

## Guardrails
- Never invent auth/permission logic — flag it as a TODO and ask.
- Keep backend and frontend field names consistent via an explicit mapping layer if naming conventions differ; don't silently rename.
