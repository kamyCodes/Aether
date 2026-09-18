import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SettingsStore } from '../server/settings.js';
import { SetupManager } from '../server/setup.js';
import { OmniClient } from '../server/omni.js';

/**
 * First-run setup flow (spec Section 3.5): the de facto first-run test for
 * every release. Runs against a completely fresh sandbox directory and
 * exercises the real SetupManager + SettingsStore.
 */

let home = '';

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-setup-'));
});

function fresh() {
  const settings = new SettingsStore(home);
  const omni = new OmniClient(settings.settings.omni);
  const setup = new SetupManager(settings, omni, home);
  return { settings, omni, setup };
}

const SETUP_FILE = () => path.join(home, 'setup.json');

test('fresh install: setup state reports incomplete + defaults', async () => {
  const { setup } = fresh();
  const st = await setup.getState();
  assert.equal(st.complete, false);
  assert.equal(st.dataDir, home);
  assert.ok(st.defaults.omniBaseUrl.length > 0);
  assert.ok(st.defaults.defaultProjectsDir.includes('Aether Projects'));
});

test('data-dir check performs a REAL write/delete probe', async () => {
  const { setup } = fresh();
  const target = path.join(home, 'data');
  const r = await setup.checkDataDir(target);
  assert.equal(r.ok, true);
  assert.ok(fs.existsSync(target), 'directory created');
  // No probe litter left behind.
  const leftovers = fs.readdirSync(target).filter((f) => f.includes('write-probe'));
  assert.equal(leftovers.length, 0);
  // A file-path (not dir) target must fail honestly.
  const filePath = path.join(home, 'occupied.txt');
  fs.writeFileSync(filePath, 'x');
  const bad = await setup.checkDataDir(filePath);
  assert.equal(bad.ok, false);
});

test('complete() writes through the REAL SettingsStore and stamps the marker', async () => {
  const { settings, setup } = fresh();
  const wsDir = path.join(home, 'projects');
  const r = await setup.complete({
    dataDir: home,
    omni: { baseUrl: 'http://127.0.0.1:1', apiKey: '' }, // unreachable on purpose
    workspace: { defaultDir: wsDir },
    skipped: ['omni'],
  });
  // The gateway is unreachable → its check fails, but completion still
  // persists (partially-configured install is explicit, spec Section 2 Step 5).
  const gw = r.checks.find((c) => c.item === 'Model gateway');
  assert.equal(gw?.ok, false);
  assert.ok(fs.existsSync(SETUP_FILE()), 'setup marker written');
  const marker = JSON.parse(fs.readFileSync(SETUP_FILE(), 'utf8'));
  assert.equal(marker.complete, true);
  assert.deepEqual([...marker.skipped].sort(), ['omni']);
  // Settings landed in the real store and on disk with schema version.
  assert.equal(settings.settings.omni.baseUrl, 'http://127.0.0.1:1');
  const onDisk = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'));
  assert.equal(onDisk.schemaVersion >= 1, true);
  assert.equal(onDisk.omni.baseUrl, 'http://127.0.0.1:1');
  // Projects folder was created.
  assert.ok(fs.existsSync(wsDir), 'projects folder created');
  // State now reports complete.
  const st = await setup.getState();
  assert.equal(st.complete, true);
  assert.deepEqual([...st.skipped].sort(), ['omni']);
});



test('omni check against an unreachable endpoint fails honestly', async () => {
  const { setup } = fresh();
  const r = await setup.testOmni('http://127.0.0.1:59998', '');
  assert.equal(r.ok, false);
});

test('workspace-dir check creates the folder and verifies writability', async () => {
  const { setup } = fresh();
  const dir = path.join(home, 'nested', 'deeper', 'projects');
  const r = await setup.checkWorkspaceDir(dir);
  assert.equal(r.ok, true);
  assert.ok(fs.existsSync(dir));
});
