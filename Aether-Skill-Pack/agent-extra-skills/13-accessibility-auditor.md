# Accessibility Auditor (with fix-patches)

## Trigger
- Any UI component work.
- User says "check accessibility", "a11y audit", "is this compliant".

## What it does
Runs axe-core-style checks conceptually against the rendered/markup output and generates an actual patch (aria labels, contrast fixes, focus order) instead of just a report.

## Process
1. Check markup for: missing alt text, missing/incorrect ARIA roles and labels, insufficient color contrast (using known token/color values), illogical tab/focus order, missing form label associations, non-semantic elements used for interactive controls (e.g., div with onClick instead of button).
2. For each issue, determine the minimal code fix — not a rewrite of the component.
3. Generate the patch directly (diff or full corrected snippet).
4. Note anything that needs a human judgment call (e.g., what alt text should actually say for a decorative vs. meaningful image).

## Output format
- Issue list with severity (blocks screen reader / contrast fail / keyboard trap, etc.)
- Ready-to-apply patch for each fixable issue.

## Guardrails
- Don't guess alt text content for meaningful images — ask, or mark as `[TODO: describe image]` rather than inventing a false description.
- Contrast fixes must use existing design tokens, not arbitrary new colors.
