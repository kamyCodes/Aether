# i18n/Localization Completeness Checker

## Trigger
- Adding or changing user-facing text in an app with translation files.
- User says "check translations", "i18n audit".

## What it does
Diffs translation files against the base locale, flags missing keys, unused keys, and raw user-facing strings that were never wrapped in the translation function.

## Process
1. Identify the base locale file and all other locale files.
2. Diff key sets: keys present in base but missing elsewhere (untranslated), keys present in a locale but missing from base (orphaned/stale).
3. Scan component/template code for user-facing string literals that aren't passed through the translation function (`t()`, `<Trans>`, etc.) — these are the ones that will silently never get translated.
4. Check for interpolation/pluralization mismatches (e.g., base locale uses `{count}` but a translated string dropped the placeholder).

## Output format
- Missing keys per locale, orphaned keys, hardcoded strings found (file:line), placeholder mismatches.

## Guardrails
- Never auto-generate translated text yourself and mark it "done" — either flag as missing for a human/translation service, or clearly label anything you draft as a rough machine draft needing review.
