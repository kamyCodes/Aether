# Apple HIG Design Skill

## Trigger
- Building or reviewing UI intended for iOS/macOS or targeting an "Apple-native" feel.
- User says "make this feel native", "Apple-style design", "check against HIG".

## What it does
Applies Apple's Human Interface Guidelines: correct spacing/type scale, native navigation and gesture patterns, proper use of materials/blur/depth, and platform-appropriate controls — flags anything that reads as non-native.

## Process
1. Check typography against SF Pro-equivalent scale (largeTitle/title/headline/body/caption proportions) — flag arbitrary font sizes that don't map to a recognizable hierarchy.
2. Check spacing against 8pt-grid conventions (or platform default margins/padding) rather than arbitrary px values.
3. Check navigation pattern: is a sheet used where a sheet is expected (modal, non-hierarchical task), is a push/nav-stack used for hierarchical drill-down, are tabs used for top-level peer sections (not more than 5)?
4. Check control choices: segmented control vs. tabs vs. picker used appropriately for the number/type of options; destructive actions styled distinctly (red) and usually behind confirmation; context menus for secondary actions instead of cluttering primary UI.
5. Check use of materials: blur/translucency used for overlays/bars per HIG depth conventions, not flat opaque panels where the platform convention is translucent.
6. Flag anything that's a direct port of a web/Android pattern without platform adaptation (e.g., a hamburger menu where a tab bar would be more native).

## Output format
- Checklist: HIG area | current implementation | native-pattern recommendation

## Guardrails
- HIG is guidance, not absolute law — if the user has an explicit brand-design reason to deviate, note the deviation rather than forcing strict compliance.
