# Visual Regression Diffing Agent

## Trigger
- Any change to component styling or layout.
- User says "check for visual regressions", "did this change break the layout".

## What it does
Compares before/after rendered output of a component at multiple breakpoints and highlights actual pixel-level/layout differences, not just "the code changed."

## Process
1. Identify the breakpoints relevant to this component (mobile/tablet/desktop, or project-specific breakpoints).
2. Render (or describe precisely, if no screenshot tooling is available) the component before and after the change at each breakpoint.
3. Compare: layout shifts, overflow/clipping, spacing changes, unintended style bleed into other elements.
4. Distinguish intentional changes (part of what was asked for) from unintended side effects.

## Output format
- Per-breakpoint comparison: what changed, intentional or unintended, severity if unintended (cosmetic vs. broken layout).

## Guardrails
- If no actual screenshot/rendering capability is available in this environment, say so explicitly rather than fabricating a visual diff — fall back to a static analysis of computed styles and layout properties.
