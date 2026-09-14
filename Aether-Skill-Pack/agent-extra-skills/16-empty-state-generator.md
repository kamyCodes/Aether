# Empty-State / Edge-State Generator

## Trigger
- Any list, table, dashboard, or data-driven component.
- User says "handle the empty state", "what about loading/errors".

## What it does
Auto-generates the loading, empty, error, and overflow states for a data-driven component — the states usually forgotten until QA finds them.

## Process
1. Identify the component's data source and what states it can realistically be in: loading (initial + refetch), empty (zero results), error (fetch failed), partial/overflow (data truncated, pagination edge), and success.
2. For each missing state, generate the UI: skeleton for loading, a clear message + optional action for empty (not just "No data"), an error state with retry action, and overflow handling (truncation, "show more", pagination).
3. Match existing visual style/tokens used elsewhere in the app for these states, if such patterns exist.

## Output format
- Code for each missing state, plus a short note on which states were already handled vs. newly added.

## Guardrails
- Empty-state copy should be specific to the context (e.g., "No invoices yet — create your first one" not generic "No data"), but don't invent business logic (like CTA destinations) without confirming.
