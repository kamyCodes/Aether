import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('audit gate: repository passes the production-readiness search patterns', () => {
  let out = '';
  try {
    out = execFileSync('node', [path.join(ROOT, 'scripts', 'audit-gate.mjs'), ROOT], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    // The gate exits 1 on violations — surface its full report in the failure.
    throw new Error((e as { stdout?: string }).stdout ?? String(e));
  }
  if (!out.includes('AUDIT GATE: CLEAN')) throw new Error(out);
});
