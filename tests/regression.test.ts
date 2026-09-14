// Zero-dependency regression suite for bugs found during live sessions.
// Run with: npm test   (node:test + the installed tsx loader)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WorkspaceManager } from '../server/workspace.js';

function fixtureWorkspace(gitignore: string) {
  const root = mkdtempSync(join(tmpdir(), 'aether-test-'));
  writeFileSync(join(root, '.gitignore'), gitignore);
  writeFileSync(join(root, 'app.ts'), 'export const x = 1;\n');
  return root;
}

// Regression: a .gitignore with a `!` negation rule used to make the single
// picomatch() call invert and ignore EVERY file, yielding an empty tree.
test('.gitignore with negation rule does not blank the file tree', () => {
  const root = fixtureWorkspace('dist/\n!important.ts\n');
  const ws = new WorkspaceManager();
  const m = ws.isIgnored(root, 'app.ts');
  assert.equal(m, false, 'app.ts must not be ignored when .gitignore has a negation rule');
  assert.equal(ws.isIgnored(root, 'dist/bundle.js'), true, 'dist/ must still be ignored');
  assert.equal(ws.isIgnored(root, 'important.ts'), false, 'negated rule must un-ignore');
  rmSync(root, { recursive: true, force: true });
});

test('plain .gitignore rules still ignore their targets', () => {
  const root = fixtureWorkspace('node_modules/\nsecret.txt\n');
  const ws = new WorkspaceManager();
  assert.equal(ws.isIgnored(root, 'node_modules/lib/index.js'), true);
  assert.equal(ws.isIgnored(root, 'secret.txt'), true);
  assert.equal(ws.isIgnored(root, 'src/main.ts'), false);
  rmSync(root, { recursive: true, force: true });
});

test('no .gitignore means nothing is ignored', () => {
  const root = mkdtempSync(join(tmpdir(), 'aether-test-'));
  const ws = new WorkspaceManager();
  assert.equal(ws.isIgnored(root, 'anything.txt'), false);
  rmSync(root, { recursive: true, force: true });
});

// Security regression: user-controlled values must reach the PowerShell picker
// only as argv, never interpolated into the generated script source.
test('generated picker script is static — no user input interpolated', async () => {
  const mod = await import('../server/folderPicker.js');
  const evil = '"); Start-Process calc; ("';
  const script = mod.__test.buildPsScript();
  assert.ok(!script.includes(evil), 'user input must never appear in generated script source');
  assert.ok(script.includes('$StartDir'), 'script should take values via parameters');
  assert.ok(script.includes("param([string]$StartDir"), 'mode/marker/startDir arrive as param() arguments');
});
