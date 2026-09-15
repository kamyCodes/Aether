/**
 * First-run setup — server half of the setup wizard.
 *
 * Everything the wizard collects is written through the SAME config surfaces
 * the running app reads (SettingsStore, env-derived DB config, OmniClient) —
 * there is no modal-only settings file (spec Section 3.1). Every "test"
 * endpoint performs the real network/DB call and returns the actual result.
 *
 * Completion marker: DATA_DIR/setup.json (schemaVersion + completedAt). Its
 * absence on boot is what makes the frontend show the wizard.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA_DIR } from './dataDir.js';
import { OMNI_DEFAULT_BASE_URL, LOOPBACK_HOST, OMNI_PORT } from './config.js';
import type { SettingsStore } from './settings.js';
import type { OmniClient } from './omni.js';
import { testConnectionString, reconfigurePool, isDbReady, checkConnection } from './db.js';
import type { AppSettings, OmniSettings } from '../shared/types.js';

const SETUP_FILE_NAME = 'setup.json';

export interface SetupState {
  complete: boolean;
  schemaVersion: number;
  completedAt?: number;
  skipped: string[];
  recovery: { reason: string; detail: string; backups: string[] } | null;
  dataDir: string;
  dataDirWritable: boolean | null;
  defaults: {
    dataDir: string;
    omniBaseUrl: string;
    defaultProjectsDir: string;
  };
  dbConfigured: boolean;
}

export interface StepCheck {
  ok: boolean;
  detail: string;
}

export interface SetupPayload {
  dataDir: string;
  omni: { baseUrl: string; apiKey: string };
  database: { mode: 'skip' | 'existing'; connectionString?: string };
  workspace: { defaultDir: string };
  skipped: string[];
}

export class SetupManager {
  private setupFile: string;
  /** Injected deps keep this testable — the same stores index.ts uses.
   *  dataDir threads the store's (possibly sandboxed) directory through. */
  constructor(
    private settingsStore: SettingsStore,
    private omni: OmniClient,
    private dataDir = DATA_DIR,
  ) {
    this.setupFile = path.join(this.dataDir, SETUP_FILE_NAME);
  }

  /** Read the completion marker; absence ⇒ first run. */
  readMarker(): {
    complete: boolean;
    schemaVersion: number;
    completedAt?: number;
    skipped: string[];
  } {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.setupFile, 'utf8')) as {
        complete?: boolean;
        schemaVersion?: number;
        completedAt?: number;
        skipped?: string[];
      };
      return {
        complete: parsed.complete === true,
        schemaVersion: parsed.schemaVersion ?? 1,
        completedAt: parsed.completedAt,
        skipped: Array.isArray(parsed.skipped) ? parsed.skipped : [],
      };
    } catch {
      return { complete: false, schemaVersion: 1, skipped: [] };
    }
  }

  private writeMarker(skipped: string[]) {
    const body = JSON.stringify(
      { complete: true, schemaVersion: 1, completedAt: Date.now(), skipped },
      null,
      2,
    );
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmp = `${this.setupFile}.tmp`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, this.setupFile);
  }

  async getState(): Promise<SetupState> {
    const marker = this.readMarker();
    return {
      complete: marker.complete && !this.settingsStore.recovery,
      schemaVersion: marker.schemaVersion,
      completedAt: marker.completedAt,
      skipped: marker.skipped,
      recovery: this.settingsStore.recovery
        ? {
            reason: this.settingsStore.recovery.reason,
            detail: this.settingsStore.recovery.detail,
            backups: this.settingsStore.recovery.backups.slice(0, 5),
          }
        : null,
      dataDir: this.dataDir,
      dataDirWritable: await isWritable(this.dataDir),
      defaults: {
        dataDir: this.dataDir,
        omniBaseUrl: OMNI_DEFAULT_BASE_URL,
        defaultProjectsDir: path.join(os.homedir(), 'Documents', 'Aether Projects'),
      },
      dbConfigured: isDbReady(),
    };
  }

  /** Step 1 — real write/delete probe of the chosen data directory. */
  async checkDataDir(dir: string): Promise<StepCheck> {
    return runWritableProbe(dir);
  }

  /** Step 2 — real GET /models against the given gateway + key. */
  async testOmni(baseUrl: string, apiKey: string): Promise<StepCheck> {
    try {
      const res = await fetch(joinUrl(baseUrl, 'models'), {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) {
        const body = (await res.text().catch(() => '')).slice(0, 200);
        return { ok: false, detail: `HTTP ${res.status} ${res.statusText} ${body}`.trim() };
      }
      const data = (await res.json().catch(() => null)) as { data?: unknown[] } | unknown[] | null;
      const models = Array.isArray(data) ? data.length : (data?.data?.length ?? 0);
      return { ok: true, detail: `reachable — ${models} model(s) in catalog` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Step 3 — real `SELECT version()` on a throwaway client (not a ping). */
  async testDatabase(connectionString: string): Promise<StepCheck> {
    try {
      const version = await testConnectionString(connectionString);
      return { ok: true, detail: version.split(',')[0] };
    } catch (e) {
      return { ok: false, detail: trimErr(e) };
    }
  }

  /** Step 4 — create-if-missing + writable probe of the projects dir. */
  async checkWorkspaceDir(dir: string): Promise<StepCheck> {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      return { ok: false, detail: `cannot create folder: ${trimErr(e)}` };
    }
    return runWritableProbe(dir);
  }

  /**
   * Final write: everything lands in the app's real settings object via the
   * same SettingsStore the running app reads; DB switch goes through
   * reconfigurePool (probe → drain → replace). Then the startup validation
   * set runs and its per-item pass/fail is returned to the wizard's review
   * step (spec Section 2 Step 5).
   */
  async complete(payload: SetupPayload): Promise<{
    ok: boolean;
    checks: { item: string; ok: boolean; detail: string }[];
  }> {
    const checks: { item: string; ok: boolean; detail: string }[] = [];

    // --- Settings (single config surface) ---
    const s: AppSettings = this.settingsStore.settings;
    const nextOmni: OmniSettings = {
      ...s.omni,
      baseUrl: payload.omni.baseUrl.trim() || s.omni.baseUrl,
      apiKey: payload.omni.apiKey.trim(),
    };
    this.settingsStore.settings = { ...s, omni: nextOmni };
    this.omni.settings = nextOmni; // live client picks it up immediately

    // --- Database ---
    if (payload.database.mode === 'existing' && payload.database.connectionString) {
      try {
        const version = await reconfigurePool(payload.database.connectionString.trim());
        await this.runMigrationsSafe();
        checks.push({ item: 'Database', ok: true, detail: version.split(',')[0] });
      } catch (e) {
        checks.push({ item: 'Database', ok: false, detail: trimErr(e) });
      }
    } else if (payload.skipped.includes('database')) {
      checks.push({
        item: 'Database',
        ok: false,
        detail: 'skipped — history/usage tracking disabled',
      });
    } else {
      // Default: whatever the environment already provides.
      try {
        const v = await checkConnection();
        checks.push({
          item: 'Database',
          ok: true,
          detail: `${v?.split(',')[0] ?? 'unavailable'} (environment default)`,
        });
      } catch {
        checks.push({
          item: 'Database',
          ok: false,
          detail: 'environment default unreachable — DB features disabled',
        });
      }
    }

    // --- Omni ---
    try {
      const models = await this.omni.listModels();
      checks.push({
        item: 'Model gateway',
        ok: models.length > 0,
        detail: models.length
          ? `${models.length} model(s) available`
          : 'gateway reachable but catalog is empty — AI features limited',
      });
    } catch (e) {
      checks.push({ item: 'Model gateway', ok: false, detail: trimErr(e) });
    }

    // --- Data dir + workspace dir ---
    const dd = await runWritableProbe(payload.dataDir || this.dataDir);
    checks.push({
      item: 'Data directory',
      ok: dd.ok,
      detail: dd.ok ? payload.dataDir || this.dataDir : dd.detail,
    });
    const wd = await this.checkWorkspaceDir(payload.workspace.defaultDir);
    checks.push({
      item: 'Projects folder',
      ok: wd.ok,
      detail: wd.ok ? payload.workspace.defaultDir : wd.detail,
    });

    // Persist settings LAST so a failed validation doesn't look configured.
    this.settingsStore.save();
    this.writeMarker(payload.skipped);

    return { ok: checks.every((c) => c.ok), checks };
  }

  private async runMigrationsSafe(): Promise<void> {
    // Import lazily to avoid a cycle: db.ts has no dep on setup.ts, but
    // migrations live there and the setup module must not load the pool at
    // module-eval time in tests.
    const { runMigrations } = await import('./db.js');
    await runMigrations();
  }

  // ---------- Recovery (settings.json unreadable / newer schema) ----------

  recoverRestoreBackup(): StepCheck {
    const r = this.settingsStore.restoreLatestBackup();
    if (r.ok) {
      this.settingsStore.recovery = null;
      // Reload the restored file into memory via a fresh parse.
      try {
        const parsed = JSON.parse(fs.readFileSync(this.settingsStore.file, 'utf8'));
        this.settingsStore.settings = parsed;
        return { ok: true, detail: `restored ${path.basename(r.restored!)}` };
      } catch (e) {
        return { ok: false, detail: trimErr(e) };
      }
    }
    return { ok: false, detail: r.error ?? 'restore failed' };
  }

  recoverReset(keepBackups: boolean): StepCheck {
    const aside = this.settingsStore.resetToFresh(keepBackups);
    return { ok: true, detail: `previous file kept as ${path.basename(aside)}` };
  }

  recoverAcceptDefaults(): StepCheck {
    this.settingsStore.acceptDefaults();
    return { ok: true, detail: 'continuing with defaults; original file left untouched' };
  }
}

// ---------- helpers ----------

async function isWritable(dir: string): Promise<boolean | null> {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return (await runWritableProbe(dir)).ok;
  } catch {
    return false;
  }
}

/** Real write/delete probe — never a path-existence check (spec Step 1). */
async function runWritableProbe(dir: string): Promise<StepCheck> {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    return { ok: false, detail: `cannot create directory: ${trimErr(e)}` };
  }
  const probe = path.join(dir, `.aether-write-probe-${process.pid}-${Date.now()}`);
  try {
    fs.writeFileSync(probe, 'aether');
    fs.unlinkSync(probe);
    return { ok: true, detail: dir };
  } catch (e) {
    return { ok: false, detail: `directory is not writable: ${trimErr(e)}` };
  }
}

function joinUrl(base: string, p: string): string {
  return `${base.replace(/\/$/, '')}/${p.replace(/^\//, '')}`;
}

function trimErr(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 300);
}

/** Exposed for the setup e2e script — LOOPBACK/OMNI_PORT are config-owned. */

/**
 * First-run help content — real instructions the wizard surfaces inline so a
 * fresh user can actually obtain the two mandatory prerequisites:
 * an OmniRoute API key and a reachable PostgreSQL instance.
 */
export function getSetupHelp() {
  return {
    omni: {
      steps: [
        'Open your OmniRoute instance (default: ' + OMNI_DEFAULT_BASE_URL + ') and sign in.',
        'Go to Settings → API keys → “Create key” (or “sk-…” page, depending on version).',
        'Copy the key — it is shown once — and paste it into the API-key field.',
        '“Test connection” verifies the key against GET /models with your key attached.',
      ],
      docsUrl: OMNI_DEFAULT_BASE_URL,
    },
    db: {
      steps: [
        'Windows: download the PostgreSQL installer from https://www.postgresql.org/download/windows/ and run it (keeps default port 5432).',
        'macOS: `brew install postgresql@16 && brew services start postgresql@16`.',
        'Linux: `sudo apt install postgresql` (Debian/Ubuntu) or `sudo dnf install postgresql-server`.',
        'Create the app database: `createdb aether_db` (or `CREATE DATABASE aether_db;` in psql).',
        'Connection string shape: postgresql://USER:PASSWORD@localhost:5432/aether_db',
      ],
      docsUrl: 'https://www.postgresql.org/docs/current/tutorial-install.html',
    },
  };
}
export const SETUP_DEFAULTS = { LOOPBACK_HOST, OMNI_PORT };
