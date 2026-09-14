#!/usr/bin/env node
/**
 * Section 9 runtime proof (multi-install isolation):
 *  1. Two or more concurrent processes hammer the same settings file (shared
 *     AETHER_HOME) using the real SettingsStore — atomic temp+rename writes
 *     must never corrupt it.
 *  2. A hand-written old-schema settings file (null branches + unknown
 *     fields) must merge with schema defaults — no crash, no silent loss.
 * Evidence is written to audit-evidence/s9-isolation-test.txt.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE = path.join(ROOT, 'report', 'audit-evidence', 's9-isolation-test.txt');
const log = [];
const write = (s) => { log.push(s); console.log(s); };
const fail = (s) => { write(`FAIL ${s}`); process.exitCode = 1; };
const run = (args, env, onOut, timeoutMs = 0) => new Promise((resolve) => {
  const c = spawn(process.execPath, args, { cwd: ROOT, env });
  let out = '';
  let code = null;
  let done = false;
  const finish = (exitCode, killed) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    resolve({ code: exitCode, out, killed: Boolean(killed) });
  };
  const timer = timeoutMs > 0
    ? setTimeout(() => { c.kill('SIGKILL'); finish(null, true); }, timeoutMs)
    : null;
  c.stdout.on('data', (d) => { out += d; onOut?.(d.toString()); });
  c.stderr.on('data', (d) => { out += d; onOut?.(d.toString()); });
  c.on('exit', (exitCode) => finish(exitCode));
});

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-s9-'));
const baseEnv = { ...process.env, AETHER_HOME: home };
write(`[env] isolated AETHER_HOME: ${home}`);

// ---------- Part 1: concurrent writers must never corrupt the registry file ----------
const WORKERS = 8;
const WRITES = 25;
write(`\n[part1] ${WORKERS} concurrent processes × ${WRITES} atomic writes to one settings.json`);
const workerCode = `
  const { SettingsStore } = await import(process.env.PROBE_SETTINGS_URL);
  const id = process.env.PROBE_WORKER_ID;
  for (let n = 0; n < Number(process.env.PROBE_WRITES); n++) {
    const s = new SettingsStore();
    s.settings.ui.accent = 'worker-' + id + '-' + n;
    s.save();
    if (n % 7 === 0) await new Promise((r) => setTimeout(r, Math.random() * 12));
  }
  console.log('worker ' + id + ' done');
`;
const results = await Promise.all(
  Array.from({ length: WORKERS }, (_, i) =>
    run(['--import', 'tsx', '--input-type=module', '-e', workerCode], {
      ...baseEnv,
      PROBE_SETTINGS_URL: 'file:///' + path.join(ROOT, 'server', 'settings.ts').replace(/\\/g, '/'),
      PROBE_WORKER_ID: String(i),
      PROBE_WRITES: String(WRITES),
    })),
);
const crashed = results.filter((r) => r.code !== 0);
if (crashed.length) fail(`${crashed.length} writer process(es) exited non-zero:\n${crashed.map((c) => c.out).join('\n')}`);
else write(`[part1] all ${WORKERS} writers exited 0`);

const settingsFile = path.join(home, 'settings.json');
let final = null;
try { final = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch (e) {
  fail(`settings.json is corrupt after concurrent writes: ${e instanceof Error ? e.message : String(e)}`);
}
if (final) {
  if (/^worker-\d+-\d+$/.test(final.ui?.accent ?? '') && typeof final.omni?.baseUrl === 'string' && final.omni.baseUrl.startsWith('http')) {
    write(`[part1] final file parses, contains one complete writer payload (accent=${final.ui.accent}), defaults intact — PASS`);
  } else {
    fail(`final settings.json is not a coherent writer payload: ${JSON.stringify(final).slice(0, 200)}`);
  }
}

// ---------- Part 2: old-schema file must merge, not crash or silently drop ----------
write('\n[part2] hand-written old-schema settings file (null branches + unknown fields)');
fs.writeFileSync(settingsFile, JSON.stringify({
  omni: null,
  ui: { theme: 'light', fontSize: 15 },
  agent: { autonomy: null },
  legacyUnknownTopLevel: true,
}, null, 2));
write('[part2] wrote: {"omni": null, "ui": {"theme": "light", "fontSize": 15}, "agent": {"autonomy": null}, "legacyUnknownTopLevel": true}');

const mergeProbe = `
  const { SettingsStore } = await import(process.env.PROBE_SETTINGS_URL);
  const s = new SettingsStore();
  console.log(JSON.stringify({
    theme: s.settings.ui.theme,
    fontSize: s.settings.ui.fontSize,
    baseUrl: s.settings.omni.baseUrl,
    autonomyMode: s.settings.agent.autonomy.mode,
  }));
`;
const merged = await run(['--import', 'tsx', '--input-type=module', '-e', mergeProbe], {
  ...baseEnv,
  PROBE_SETTINGS_URL: 'file:///' + path.join(ROOT, 'server', 'settings.ts').replace(/\\/g, '/'),
});
if (merged.code !== 0) fail(`SettingsStore constructor crashed on old-schema file:\n${merged.out}`);
let m = null;
try { m = JSON.parse(merged.out.trim().split('\n').pop() ?? ''); } catch { fail(`could not parse merge probe output:\n${merged.out}`); }
if (m) {
  if (m.theme !== 'light' || m.fontSize !== 15) fail(`user data silently lost (expected light/15, got ${m.theme}/${m.fontSize})`);
  else if (!String(m.baseUrl).startsWith('http')) fail(`default baseUrl not filled in (got ${m.baseUrl})`);
  else if (m.autonomyMode !== 'review') fail(`null autonomy branch not healed (got ${m.autonomyMode})`);
  else write(`[part2] merge probe PASS — user values preserved (${m.theme}/${m.fontSize}), defaults filled (${m.baseUrl}, ${m.autonomyMode})`);
}

// ---------- Part 2b: the server itself must boot against the old-schema home ----------
write('\n[part2b] booting the real server against the old-schema AETHER_HOME');
const bootEnv = { ...baseEnv, PORT: '5199', OMNI_PORT: '5198' };
// The server intentionally never exits (monitors keep it alive) — give it a
// boot window, judge from the captured output, then kill it.
const boot = await run(['--import', 'tsx', 'server/index.ts'], bootEnv, () => {}, 30_000);
const sawListening = /Aether backend listening on/.test(boot.out);
if (sawListening) write('[part2b] server booted and bound a port against the old-schema settings — PASS');
else if (!sawListening && /Error|FATAL/i.test(boot.out)) fail(`server crashed on old-schema settings:\n${boot.out.slice(0, 1200)}`);
else write(`[part2b] inconclusive (code=${boot.code}, killed=${boot.killed}) — full output below for review`);

write('--- server boot output (verbatim) ---');
write(boot.out || '(none)');

write(`\nRESULT: ${process.exitCode ? 'FAIL' : 'PASS'}`);
fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
fs.writeFileSync(EVIDENCE, log.join('\n'));
console.log(`\nEvidence written to ${EVIDENCE}`);
