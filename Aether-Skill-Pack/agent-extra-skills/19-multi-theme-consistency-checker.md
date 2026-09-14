# Multi-Theme Consistency Checker

## Trigger
- App supports dark/light/brand or other theme variants.
- User says "check this in dark mode", "does this work across themes".

## What it does
Verifies a new or changed component renders correctly across every supported theme variant, not just the one it was built/tested in.

## Process
1. Identify all theme variants the project supports (check theme config/provider).
2. For the component in question, check every color/style reference resolves to a theme-aware token (not a hardcoded value that will look wrong in other themes).
3. Specifically check for: insufficient contrast in dark mode, borders/dividers that disappear against certain backgrounds, images/icons that need theme-specific variants (e.g., logos), and shadows that don't read correctly on dark backgrounds.
4. Flag every hardcoded value found as a likely theme-consistency bug.

## Output format
- Per-theme checklist: theme | issues found | fix (usually: replace with theme-aware token)

## Guardrails
- Don't assume a "close enough" contrast in a non-default theme is fine — apply the same contrast standard across all themes, not just the primary one.
