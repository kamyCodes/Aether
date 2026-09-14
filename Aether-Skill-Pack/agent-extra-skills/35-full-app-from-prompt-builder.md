# Full-App-From-Prompt Builder

## Trigger
- User gives a plain product description and wants a working app, not just a single file/component.
- User says "build me an app that...", "scaffold a full product for...".

## What it does
Takes a plain-language product description and scaffolds a complete, architecturally coherent app in one pass — frontend, backend, data model, auth — with a written rationale for each structural decision, not a pile of disconnected files.

## Process
1. Extract the core entities and user flows from the description before writing any code. State them back explicitly (e.g., "Entities: User, Project, Task. Core flow: user creates project → adds tasks → marks complete.").
2. Choose the stack based on what's already in the repo if one exists; otherwise pick a stack and state why (e.g., "React + FastAPI + Postgres because you mentioned needing real-time updates and structured data").
3. Design the data model first (tables/entities + relationships), then auth strategy (if the app has users), then the API surface, then the frontend — in that order, so later layers are grounded in earlier decisions rather than improvised.
4. Build incrementally: data layer → API → frontend, checking each layer works before building the next on top of it.
5. Write a short rationale doc alongside the code: what was built, why this structure, what's deliberately left as a stub/TODO for the user to fill in (e.g., payment integration, specific business rules).

## Output format
- Project structure, the rationale doc, and the code itself, delivered layer by layer with a working checkpoint at each stage.

## Guardrails
- Don't silently invent business-critical decisions (pricing logic, auth provider, data retention rules) — make a reasonable default choice, state it explicitly, and flag it as something to confirm rather than treating it as settled.
- Never claim the app is "done" if auth, error handling, or core flows are stubbed — say exactly what's real and what's scaffold.
