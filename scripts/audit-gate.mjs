#!/usr/bin/env node
/**
 * Production-readiness search gate (audit Sections 1–7, 10).
 *
 * Runs the audit's ripgrep patterns over the repository and exits 1 on any
 * match that is not explicitly allowlisted in scripts/audit-allowlist.json.
 * CI runs this on every commit so the audit cannot silently regress.
 *
 * Usage: node scripts/audit-gate.mjs [repoRoot] [allowlistPath]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { rgPath } from '@vscode/ripgrep';

const ROOT = path.resolve(process.argv[2] ?? '.');
const ALLOW_PATH = path.resolve(
  process.argv[3] ?? path.join(ROOT, 'scripts', 'audit-allowlist.json'),
);

/** ripgrep type flags. NOTE: rg's `ts` type already covers *.ts AND *.tsx
 *  (`js` covers *.js, *.jsx, *.mjs), and type flags OR together while globs
 *  AND with them — adding `-g '*.tsx'` here would silently restrict the whole
 *  scan to only .tsx files. Never combine the two. */
const SRC = ['-t', 'ts', '-t', 'js', '-t', 'json'];

/** Generated artifacts are audited at the source: they are rebuilt from the
 *  files this gate scans and would otherwise shadow real violations. */
const ARTIFACT_GLOBS = [
  '-g',
  '!node_modules/**',
  '-g',
  '!dist/**',
  '-g',
  '!dist-server/**',
  '-g',
  '!release/**',
  '-g',
  '!coverage/**',
  '-g',
  '!audit-evidence/**',
  // The audit report + its evidence (archived under docs/archive/) quote the
  // violation patterns verbatim — it is an output of the audit, not scanned
  // input for it.
  '-g',
  '!docs/archive/**',
];
const applyGlobs = (args) => [...args, ...ARTIFACT_GLOBS];

/** [name, pattern, args] — patterns mirror the audit document ( Sections 1–7). */
const CHECKS = [
  // S1 — hardcoded file paths
  ['S1.windows-users-path', 'C:\\\\Users', SRC],
  ['S1.unix-home-path', '/home/[a-zA-Z0-9_]+', SRC],
  ['S1.quoted-drive-letter', '"[A-Za-z]:\\\\', SRC],
  ['S1.concat-literal-slash', '\\+\\s*[\'"]/[a-zA-Z]', SRC],
  ['S1.tilde-home-literal', '(path\\.(join|resolve)\\([^)]*)[\'"]~/', SRC],
  // S2 — hardcoded ports / hosts (allowed only in the single config module)
  ['S2.hardcoded-port', ':[0-9]{4,5}[^0-9]', SRC],
  ['S2.localhost', 'localhost', SRC],
  ['S2.loopback-ip', '127\\.0\\.0\\.1', SRC],
  // S3 — secrets
  [
    'S3.credential-assignment',
    '(api[_-]?key|secret|token|password)\\s*[:=]\\s*["\'][A-Za-z0-9]{10,}',
    SRC,
  ],
  ['S3.openai-key-shape', 'sk-[A-Za-z0-9]{20,}', []],
  // S4 — model id literals (allowed only in the settings-schema default module)
  ['S4.model-id-literals', '"(gpt-|claude-|mock-|mini|coder)"', SRC],
  // S5 — mocks/stubs/placeholders + unfinished-work markers
  // --pcre2: the fake(?!r) lookahead needs the PCRE2 engine (@vscode/ripgrep ships it).
  [
    'S5.mock-stub-placeholder',
    'mock|stub|dummy|fake(?!r)',
    ['--pcre2', '-i', '-t', 'ts', '-t', 'js', '-t', 'json'],
  ],
  ['S5.todo-markers', 'TODO|FIXME|HACK|XXX', []],
  ['S5.not-implemented', 'throw new Error\\("not implemented"\\)|NotImplementedError', []],
  // S6 — dead flags / env feature switches
  ['S6.dead-branch', 'if\\s*\\(\\s*(true|false)\\s*\\)', SRC],
  ['S6.feature-env-flag', 'ENABLE_|FEATURE_|DEBUG', SRC],
  // S7 — locale-dependent date formatting (must use the shared date utils)
  ['S7.toLocale*', 'toLocaleString\\(\\)|toLocaleDateString\\(\\)', SRC],
];

let allow = { allowFiles: {}, allowMatches: {} };
try {
  allow = JSON.parse(fs.readFileSync(ALLOW_PATH, 'utf8'));
} catch {
  /* empty allowlist */
}

let failures = 0;
const lines = [];

for (const [name, pattern, extra] of CHECKS) {
  const args = applyGlobs([...extra, '-n', '--no-heading', pattern, '.']);
  let out = '';
  let code = 0;
  try {
    out = execFileSync(rgPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    code = e.status ?? 1;
    out = e.stdout ?? '';
  }
  // rg exit 1 = no matches (clean); 2 = error; 0 = matches found
  if (code === 1 || out.trim() === '') {
    lines.push(`PASS ${name}: 0 matches`);
    continue;
  }
  if (code >= 2) {
    lines.push(`ERROR ${name}: ripgrep failed — ${out.trim().split('\n')[0]}`);
    failures++;
    continue;
  }
  const hits = out.trim().split('\n').filter(Boolean);
  const allowedFiles = allow.allowFiles?.[name] ?? [];
  const allowedMatches = allow.allowMatches?.[name] ?? [];
  /** rg prints OS-native paths (`.\src\x.ts` on Windows); normalize to the
   *  allowlist's forward-slash form before comparing. */
  const normFile = (f) => f.replace(/\\/g, '/').replace(/^\.\//, '');
  const violations = hits.filter((h) => {
    const file = normFile(h.split(':')[0]);
    if (allowedFiles.includes(file)) return false;
    return !allowedMatches.some((m) => h.includes(m));
  });
  if (violations.length === 0) {
    lines.push(`PASS ${name}: ${hits.length} allowlisted match(es), 0 violations`);
  } else {
    lines.push(`FAIL ${name}: ${violations.length} violation(s)`);
    for (const v of violations) lines.push(`  ${v}`);
    failures++;
  }
}

console.log(lines.join('\n'));
console.log(failures === 0 ? '\nAUDIT GATE: CLEAN' : `\nAUDIT GATE: ${failures} failing check(s)`);
process.exit(failures === 0 ? 0 : 1);
