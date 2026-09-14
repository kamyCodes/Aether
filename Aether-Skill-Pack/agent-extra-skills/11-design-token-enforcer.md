# Design-Token Enforcer

## Trigger
- Any new or modified UI component.
- User says "check this against our design tokens", "fix hardcoded styles".

## What it does
Scans components for hardcoded colors, spacing, and font values and rewrites them against the project's existing design tokens/theme variables.

## Process
1. Locate the project's token source (theme file, CSS variables, Tailwind config, design-system package).
2. Scan the target component(s) for raw hex/rgb colors, magic-number spacing (px/rem not matching the scale), and non-token font sizes/weights.
3. Map each hardcoded value to the nearest matching token. If no close match exists, flag it explicitly rather than forcing a bad fit.
4. Rewrite the component to reference tokens instead of raw values.

## Output format
- Table: hardcoded value | location | replaced with token | confidence (exact match / nearest approximation)

## Guardrails
- Never force a value onto a token that's a poor match (e.g., snapping a very custom color to an unrelated token) — flag "no good token exists" instead and let the user decide whether to add one.
