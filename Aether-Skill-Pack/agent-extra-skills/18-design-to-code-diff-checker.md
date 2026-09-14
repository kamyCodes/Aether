# Design-to-Code Diff Checker

## Trigger
- A Figma frame/link or design spec is provided alongside implemented code.
- User says "does this match the design", "check against Figma".

## What it does
Compares the shipped component against the provided design reference (spacing, type scale, colors, sizing) and lists concrete, actionable mismatches.

## Process
1. Extract the specific values from the design reference: spacing (px/rem), font sizes/weights, colors (hex), component dimensions, corner radius, etc. If given only an image, describe measurements as precisely as possible rather than guessing exact pixel values.
2. Extract the same values from the implemented code.
3. Diff field by field, not just "looks close" — flag any deviation above a reasonable tolerance (e.g., >2px spacing, off-scale font size, wrong token).
4. Separate must-fix mismatches (breaks visual consistency/brand) from acceptable implementation differences (e.g., using a token that's visually identical to a raw value in the design).

## Output format
- Table: property | design value | implemented value | match? | fix needed

## Guardrails
- If working from an image rather than actual Figma data/inspect values, state the confidence level of extracted measurements rather than presenting estimates as exact.
