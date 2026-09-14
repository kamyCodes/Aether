#!/usr/bin/env node
/**
 * Token-discipline lint for agent-panel artifact CSS.
 *
 * Bans hardcoded px border-radius and padding/margin values in artifact
 * selectors (`.ac-*` and friends) — they must reference the shared tokens
 * (`--radius-card`, `--radius-input`, `--radius-badge`, `--space-*`) so the
 * agent panel and the app chrome share one design language.
 *
 * Zero dependencies: this is a hand-rolled scanner, not a stylelint plugin,
 * because the project has a no-new-npm-dependencies restriction. The rule
 * maps 1:1 onto a stylelint `declaration-property-value-disallowed-list`
 * config if stylelint is ever approved:
 *
 *   "declaration-property-value-disallowed-list": {
 *     "/^(border-radius|padding|margin)$/": ["/^\\d+px/"],
 *     "/^padding-/": ["/^\\d+px/"], "/^margin-/": ["/^\\d+px/"]
 *   }
 *
 * Allowed (shape primitives, not scale values): 999px pills, 50% dots,
 * calc()/var() references, `0`, and values inside `--radius-*`/`--space-*`
 * token definitions themselves.
 */
import fs from 'node:fs';
import path from 'node:path';

const CSS_PATH = path.resolve(process.argv[2] || 'src/styles.css');

// Artifact surface selectors — the agent panel artifacts + their children.
const ARTIFACT_SELECTOR = /(\.ac-|\.skill-editor|\.skills-panel)/;

// The px values that live INSIDE the token definitions on :root are the
// single source of truth; every other px radius/spacing in artifact rules
// is a violation.
const TOKEN_DEF_BLOCK = /:root\s*\{/;
const ALLOWED_PX = /^(999px|100%|50%)$/;

const RADIUS_PROPS = /^(border-radius|-webkit-border-radius)$/;
const SPACE_PROPS = /^(padding|margin|gap)(-(top|right|bottom|left|inline|block))?$/;

function main() {
  const src = fs.readFileSync(CSS_PATH, 'utf8');
  const lines = src.split('\n');
  const violations = [];
  let inRoot = false;
  let currentSelector = '';
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (TOKEN_DEF_BLOCK.test(trimmed)) { inRoot = true; }
    if (inRoot && trimmed === '}') { inRoot = false; continue; }
    if (inRoot) continue; // token definitions themselves are exempt

    // Track the current rule's selector (last line ending in `{` at depth 0).
    for (const ch of line) {
      if (ch === '{') { depth++; if (depth === 1) currentSelector = line.replace(/\{.*$/, '').trim(); }
      if (ch === '}') depth--;
    }

    if (depth !== 1) continue;               // only declarations inside rules
    if (!ARTIFACT_SELECTOR.test(currentSelector)) continue; // only artifact rules
    if (trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    // Waiver escape hatch: a trailing /* token-waiver: <reason> */ on the
    // declaration line exempts odd composites that don't map onto the scale.
    if (/token-waiver/.test(trimmed)) continue;

    const propMatch = trimmed.match(/^([a-z-]+)\s*:/);
    if (!propMatch) continue;
    const prop = propMatch[1];
    if (!RADIUS_PROPS.test(prop) && !SPACE_PROPS.test(prop)) continue;

    const value = trimmed.slice(propMatch[0].length).replace(/;.*$/, '').trim();
    // Strip var() and calc() segments — those are token references, allowed.
    const stripped = value.replace(/var\([^)]*\)/g, '').replace(/calc\([^)]*\)/g, '');
    const pxHits = stripped.match(/-?\d+(\.\d+)?px/g) || [];
    const bad = pxHits.filter((v) => !ALLOWED_PX.test(v));
    if (bad.length) {
      violations.push({ line: i + 1, selector: currentSelector, prop, bad: bad.join(', '), value });
    }
  }

  if (violations.length) {
    console.error(`\n✗ token-discipline: ${violations.length} hardcoded px value(s) in artifact CSS\n`);
    for (const v of violations) {
      console.error(`  ${CSS_PATH}:${v.line}  ${v.selector} :: ${v.prop}: ${v.value}   (offending: ${v.bad})`);
    }
    console.error('\nUse --radius-card / --radius-input / --radius-badge / --space-* instead.');
    console.error('Odd composites that genuinely need raw px need a line waiver: /* token-waiver: reason */');
    process.exit(1);
  }
  console.log('✓ token-discipline: artifact CSS clean — all radii/spacings use tokens or waivers');
}

main();
