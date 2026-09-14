# Component API Critic

## Trigger
- New component being added to a shared component library.
- User says "review this component's props/API", "is this consistent with our other components".

## What it does
Reviews new component props against the conventions already established elsewhere in the library (naming, boolean vs. enum patterns, controlled/uncontrolled state) before merge.

## Process
1. Sample 3-5 existing components in the library to extract current conventions: prop naming style (`isOpen` vs `open`), boolean vs. variant/enum pattern usage, event handler naming (`onChange` vs `onValueChange`), controlled/uncontrolled default behavior.
2. Compare the new component's API against these conventions.
3. Flag every deviation with the specific existing example it contradicts.
4. Propose a revised API that matches established patterns, preserving the new component's actual functionality.

## Output format
- Table: new prop | issue | matches convention from (existing component) | suggested revision

## Guardrails
- If the library genuinely has inconsistent conventions already, say so rather than picking one arbitrarily — ask which one to standardize on going forward.
