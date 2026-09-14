# Motion/Interaction Reviewer

## Trigger
- New or changed interactive component (buttons, cards, modals, nav items).
- User says "review the interactions", "check states/animations".

## What it does
Flags missing hover/focus/active/disabled states and inconsistent transition timing, and proposes a concrete motion spec instead of just noting what's missing.

## Process
1. Enumerate the interactive states a component of this type should have (default, hover, focus-visible, active/pressed, disabled, loading if applicable).
2. Check which states are implemented vs. missing.
3. For missing states, propose specific values (not just "add a hover state") — e.g., "background darken 8%, 150ms ease-out" — consistent with transition timings already used elsewhere in the codebase.
4. Check focus states specifically for keyboard accessibility (visible focus ring, not just hover-triggered styling).

## Output format
- State checklist per component: state | present? | proposed spec if missing

## Guardrails
- Pull timing/easing values from existing components in the codebase first, before inventing new ones — consistency over novelty.
- Always treat focus-visible as non-optional, even if hover is the only state the user asked about.
