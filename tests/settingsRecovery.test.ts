import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SettingsStore, SETTINGS_SCHEMA_VERSION } from '../server/settings.js';

/**
 * SettingsStore failure-path suite (spec Section 4.7): corrupt files, future
 * schema versions, migration safety, and backup/recovery flows. Each test
 * constructs the store against an isolated sandbox directory (constructor
 * injection — no module-level env races).
 */

let home = '';
let store: InstanceType<typeof SettingsStore>;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-settings-'));
  store = new SettingsStore(home);
});

const SETTINGS_FILE = () => path.join(home, 'settings.json');

test('fresh install: no settings file → defaults, no recovery, save stamps schema version', () => {
  assert.equal(store.recovery, null);
  assert.equal(store.settings.ui.theme, 'dark');
  assert.ok(store.settings.omni.baseUrl.length > 0);
  store.save();
  const onDisk = JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8'));
  assert.equal(onDisk.schemaVersion, SETTINGS_SCHEMA_VERSION);
});

test('current-version file loads intact and keeps user values', () => {
  fs.writeFileSync(
    SETTINGS_FILE(),
    JSON.stringify({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      ui: { theme: 'oled', accent: '#123456' },
    }),
  );
  const s = new SettingsStore(home);
  assert.equal(s.recovery, null);
  assert.equal(s.settings.ui.theme, 'oled');
  assert.equal(s.settings.ui.accent, '#123456');
});

test('corrupt settings.json → recovery mode, original file untouched, save blocked', () => {
  const corrupt = '{"ui": {"theme": "oled", TRUNCATED';
  fs.writeFileSync(SETTINGS_FILE(), corrupt);
  const s = new SettingsStore(home);
  assert.ok(s.recovery, 'recovery must be set');
  assert.equal(s.recovery?.reason, 'corrupt');
  // The unreadable original must still be on disk byte-for-byte.
  assert.equal(fs.readFileSync(SETTINGS_FILE(), 'utf8'), corrupt);
  // A normal save must be BLOCKED — defaults must never overwrite the file.
  assert.throws(() => s.save(), /recovery pending/);
  // acceptDefaults() is the explicit user decision that unblocks saving.
  s.acceptDefaults();
  assert.equal(s.recovery, null);
  s.save();
  assert.equal(
    JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')).schemaVersion,
    SETTINGS_SCHEMA_VERSION,
  );
});

test('newer schema version (downgraded install) → recovery mode, file untouched', () => {
  fs.writeFileSync(
    SETTINGS_FILE(),
    JSON.stringify({ schemaVersion: 999, omni: { baseUrl: 'http://future' } }),
  );
  const s = new SettingsStore(home);
  assert.ok(s.recovery, 'recovery must be set');
  assert.equal(s.recovery?.reason, 'newer-version');
  assert.equal(s.recovery?.foundVersion, 999);
  const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8'));
  assert.equal(raw.schemaVersion, 999, 'file must not be rewritten');
  assert.throws(() => s.save(), /recovery pending/);
});

test('older schema → migration runs with backup, original replaced only after verify', () => {
  // Explicit schemaVersion: 0 (the pre-versioning shape). Versionless files
  // (legacy installs) load directly without migration — covered separately.
  fs.writeFileSync(
    SETTINGS_FILE(),
    JSON.stringify({
      schemaVersion: 0,
      omni: { baseUrl: 'http://old-gateway:9999' },
      ui: { accent: '#7c9cff' },
    }),
  );
  const s = new SettingsStore(home);
  assert.equal(s.recovery, null);
  // A backup of the pre-migration file exists.
  const backups = s.listBackups();
  assert.ok(backups.length >= 1, 'pre-migration backup must exist');
  assert.ok(fs.existsSync(backups[0]), 'backup file readable');
  // Live file now carries the current schema version and defaults filled in.
  const onDisk = JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8'));
  assert.equal(onDisk.schemaVersion, SETTINGS_SCHEMA_VERSION);
  assert.equal(onDisk.omni.baseUrl, 'http://old-gateway:9999', 'user data preserved');
  assert.equal(s.migratedFromVersion, 0);
});

test('restoreLatestBackup recovers a corrupt file from the newest backup', () => {
  // Create a good file + backup, then corrupt the live one.
  fs.writeFileSync(
    SETTINGS_FILE(),
    JSON.stringify({ schemaVersion: SETTINGS_SCHEMA_VERSION, ui: { theme: 'light' } }),
  );
  const s0 = new SettingsStore(home);
  const backup = s0.backupSettings();
  assert.ok(fs.existsSync(backup));
  fs.writeFileSync(SETTINGS_FILE(), 'NOT JSON AT ALL');
  const s1 = new SettingsStore(home);
  assert.equal(s1.recovery?.reason, 'corrupt');
  const r = s1.restoreLatestBackup();
  assert.equal(r.ok, true);
  const restored = JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8'));
  assert.equal(restored.ui.theme, 'light');
});

test('resetToFresh quarantines the unreadable file (data kept, never deleted)', () => {
  fs.writeFileSync(SETTINGS_FILE(), '{{{broken');
  const s = new SettingsStore(home);
  assert.ok(s.recovery);
  const aside = s.resetToFresh(true);
  // Original content survives under the quarantine name.
  assert.ok(fs.existsSync(aside));
  assert.equal(fs.readFileSync(aside, 'utf8'), '{{{broken');
  // Live file is now a fresh valid one.
  const fresh = JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8'));
  assert.equal(fresh.schemaVersion, SETTINGS_SCHEMA_VERSION);
  assert.equal(s.recovery, null);
});

test('legacy versionless file loads directly (no migration) and keeps values', () => {
  fs.writeFileSync(
    SETTINGS_FILE(),
    JSON.stringify({ omni: { baseUrl: 'http://legacy:1' }, ui: { theme: 'light' } }),
  );
  const s = new SettingsStore(home);
  assert.equal(s.recovery, null);
  assert.equal(s.migratedFromVersion, null);
  assert.equal(s.settings.omni.baseUrl, 'http://legacy:1');
  assert.equal(s.settings.ui.theme, 'light');
  // Next save stamps the current version (lazy forward-compat).
  s.save();
  assert.equal(
    JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')).schemaVersion,
    SETTINGS_SCHEMA_VERSION,
  );
});

test('backupSettings captures current content for the pre-update insurance copy', () => {
  fs.writeFileSync(
    SETTINGS_FILE(),
    JSON.stringify({ schemaVersion: SETTINGS_SCHEMA_VERSION, ui: { theme: 'dark' } }),
  );
  const s = new SettingsStore(home);
  const b = s.backupSettings();
  assert.ok(fs.existsSync(b));
  const body = JSON.parse(fs.readFileSync(b, 'utf8'));
  assert.equal(body.ui.theme, 'dark');
});
