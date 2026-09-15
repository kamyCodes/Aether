import fs from 'node:fs';
/**
 * SettingsStore — persisted app settings (UI theme, model preferences,
 * autonomy, analytics consent) under DATA_DIR/settings.json.
 */
import path from 'node:path';
import type { AppSettings, Analytics } from '../shared/types.js';
import { DATA_DIR } from './dataDir.js';
import { OMNI_DEFAULT_BASE_URL } from './config.js';

/**
 * On-disk schema version. Bump ONLY when the persisted shape changes, and add
 * a migration in MIGRATIONS below. An older file migrates forward (backup
 * first, non-destructive); a NEWER file (downgraded install) or an unreadable
 * file puts the store into recovery mode — the UI shows the recovery options
 * instead of proceeding with guessed defaults that a later save() would bake
 * in, destroying data (spec Section 4.2/4.4).
 */
export const SETTINGS_SCHEMA_VERSION = 1;

/** A migration maps one stored version to the next. Must be additive only. */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  // v0 → v1: v1 only ADDED the schemaVersion stamp; the shape is unchanged
  // (the constructor's defaults-spread already normalizes missing branches).
  0: (raw) => ({ ...raw }),
};

/** Why recovery mode is active — drives the recovery UI copy. */
export type RecoveryReason = 'corrupt' | 'newer-version';

export interface RecoveryState {
  reason: RecoveryReason;
  detail: string;
  /** Absolute path of the untouched original file (or its backup). */
  originalPath: string;
  /** Detected schema version when the file parsed but the version is ahead. */
  foundVersion?: number;
  backups: string[];
}

/**
 * Settings schema defaults — the ONLY declaration site for default model
 * ids, gateway URL shape, and autonomy prefixes (audit Sections 2/4).
 */
const DEFAULTS: AppSettings = {
  omni: {
    baseUrl: OMNI_DEFAULT_BASE_URL,
    apiKey: '',
    timeoutMs: 60_000,
    streaming: true,
    fallbackModel: '',
    modelPrefs: {},
  },
  ui: {
    theme: 'dark',
    accent: '#6E62E5',
    fontSize: 13,
    uiScale: 'compact',
    font: 'default',
  },
  agent: {
    autonomy: {
      mode: 'review',
      allowPrefixes: ['npm test', 'npm run', 'git status', 'git log', 'git diff'],
      denyPrefixes: [],
    },
  },
};

/** Blocking sleep — for in-process retry backoff (save paths are sync). */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export class SettingsStore {
  /** Data directory this store reads/writes — defaults to DATA_DIR; tests
   *  pass an isolated sandbox explicitly (module-level env is frozen after
   *  first import, so per-instance dirs keep tests honest). */
  readonly dir: string;
  file: string;
  analyticsFile: string;
  settings: AppSettings;
  analytics: Analytics = { tokensIn: 0, tokensOut: 0, calls: 0, errors: 0, byModel: {} };
  /** Set when the on-disk file is corrupt or from a newer app version —
   *  blocks normal saves until the user picks a recovery action. */
  recovery: RecoveryState | null = null;
  /** True after a version migration ran this boot (backup + rewrite). */
  migratedFromVersion: number | null = null;

  constructor(dir = DATA_DIR) {
    this.dir = dir;
    this.file = path.join(this.dir, 'settings.json');
    this.analyticsFile = path.join(this.dir, 'analytics.json');
    fs.mkdirSync(this.dir, { recursive: true });
    let loaded: Partial<AppSettings> | undefined;
    try {
      loaded = this.readJson<Partial<AppSettings>>(this.file);
    } catch (e) {
      // Corrupt/contended file: quarantine the original untouched and enter
      // recovery — never silently fall back to defaults (save() would then
      // overwrite the user's data with them).
      this.recovery = {
        reason: 'corrupt',
        detail: e instanceof Error ? e.message : String(e),
        originalPath: this.file,
        backups: this.listBackups(),
      };
      loaded = undefined;
    }

    if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
      const raw = loaded as Partial<AppSettings> & { schemaVersion?: unknown };
      const fileVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : null;
      if (fileVersion !== null && fileVersion > SETTINGS_SCHEMA_VERSION) {
        // Downgraded install against newer data — refuse to touch it.
        this.recovery = {
          reason: 'newer-version',
          detail: `settings.json was written by schema v${fileVersion}; this build understands v${SETTINGS_SCHEMA_VERSION}.`,
          originalPath: this.file,
          foundVersion: fileVersion,
          backups: this.listBackups(),
        };
        loaded = undefined;
      } else if (fileVersion !== null && fileVersion < SETTINGS_SCHEMA_VERSION) {
        // Forward migration: read old shape → write new shape to a backup
        // first, verify readable, only then replace the original.
        try {
          const migrated = this.migrateForward(raw as Record<string, unknown>, fileVersion);
          loaded = migrated as Partial<AppSettings>;
          this.migratedFromVersion = fileVersion;
        } catch (e) {
          this.recovery = {
            reason: 'corrupt',
            detail: `migration v${fileVersion} → v${SETTINGS_SCHEMA_VERSION} failed: ${e instanceof Error ? e.message : String(e)}`,
            originalPath: this.file,
            backups: this.listBackups(),
          };
          loaded = undefined;
        }
      }
    }

    // Defensive: a hand-edited or old-schema file can carry a null branch
    // (e.g. "ui": null). Treat every branch as optional before spreading.
    if (typeof loaded !== 'object' || loaded === null || Array.isArray(loaded)) loaded = {};
    this.settings = {
      omni: {
        ...DEFAULTS.omni,
        ...loaded.omni,
        modelPrefs: { ...DEFAULTS.omni.modelPrefs, ...loaded.omni?.modelPrefs },
      },
      ui: { ...DEFAULTS.ui, ...loaded.ui },
      agent: { autonomy: { ...DEFAULTS.agent.autonomy, ...loaded.agent?.autonomy } },
    };
    this.analytics = { ...this.analytics, ...(this.readJson<Analytics>(this.analyticsFile) ?? {}) };
  }

  /**
   * JSON read with contention tolerance (audit Section 9). Only a missing
   * file falls back to `undefined` (fresh install); a contended or torn
   * read is retried with backoff and rethrown — never silently treated as
   * "no settings", which would let a later save() wipe the user's data.
   * SyntaxError retries cover the tiny non-atomic window of the copy
   * fallback in atomicWrite when a reader races a writer.
   */
  private readJson<T>(file: string): T | undefined {
    for (let attempt = 0; ; attempt++) {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        if (attempt < 5) {
          sleepSync(10 * 2 ** attempt + Math.random() * 10);
          continue;
        }
        throw new Error(
          `settings read failed for ${file}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  /**
   * Atomic write with Windows contention tolerance (audit Section 9).
   * Primary path is temp+rename (atomic). On Windows the rename fails with
   * EPERM while any other process holds the destination open — after retries
   * are exhausted we fall back to copy-in-place (readers open files with
   * write-share, so it succeeds under contention) and remove the temp file.
   * The copy's brief non-atomic window is bridged by readJson's retries.
   */
  private atomicWrite(file: string, body: string): void {
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, body);
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(tmp, file);
        return;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (attempt >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) {
          // Rename abandoned — finish via copy-in-place with its own retries.
          for (let cAttempt = 0; ; cAttempt++) {
            try {
              fs.copyFileSync(tmp, file);
              try {
                fs.unlinkSync(tmp);
              } catch {
                /* best effort */
              }
              return;
            } catch (ce) {
              if (cAttempt >= 8) {
                throw new Error(
                  `settings write failed for ${file}: ${(ce as NodeJS.ErrnoException).code ?? ''} ${ce instanceof Error ? ce.message : String(ce)}`,
                );
              }
              sleepSync(10 * 2 ** cAttempt + Math.random() * 10);
            }
          }
        }
        sleepSync(10 * 2 ** attempt + Math.random() * 10);
      }
    }
  }

  /** Timestamped backup of the settings file (pre-migration, pre-update,
   *  pre-recovery). Returns the backup path. */
  backupSettings(): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(this.dir, `settings.backup-${stamp}.json`);
    try {
      fs.copyFileSync(this.file, dest);
    } catch {
      /* source missing (fresh install) — nothing to back up */
    }
    return dest;
  }

  listBackups(): string[] {
    try {
      return fs
        .readdirSync(this.dir)
        .filter((f) => f.startsWith('settings.backup-') && f.endsWith('.json'))
        .sort()
        .reverse()
        .map((f) => path.join(this.dir, f));
    } catch {
      return [];
    }
  }

  /** Restore the newest backup over the live file (user-initiated recovery). */
  restoreLatestBackup(): { ok: boolean; restored?: string; error?: string } {
    const [latest] = this.listBackups();
    if (!latest) return { ok: false, error: 'no backups found' };
    try {
      // Sanity: the backup must parse as JSON before we replace the live file.
      JSON.parse(fs.readFileSync(latest, 'utf8'));
      fs.copyFileSync(latest, this.file);
      return { ok: true, restored: latest };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Recover to defaults: rename the unreadable original aside (data kept,
   *  never deleted) and proceed with a fresh file. */
  resetToFresh(alsoRenameBackups: boolean): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const aside = path.join(this.dir, `settings.quarantined-${stamp}.json`);
    try {
      if (fs.existsSync(this.file)) fs.renameSync(this.file, aside);
    } catch {
      /* rename may fail on Windows contention — copy then leave original */
      try {
        fs.copyFileSync(this.file, aside);
      } catch {
        /* original stays in place; recovery proceeds with defaults in memory */
      }
    }
    if (alsoRenameBackups) {
      for (const b of this.listBackups()) {
        try {
          fs.renameSync(b, path.join(this.dir, `settings.quarantined-${stamp}-${path.basename(b)}`));
        } catch {
          /* leave it */
        }
      }
    }
    this.recovery = null;
    this.settings = {
      omni: { ...DEFAULTS.omni },
      ui: { ...DEFAULTS.ui },
      agent: { autonomy: { ...DEFAULTS.agent.autonomy } },
    };
    this.save();
    return aside;
  }

  /** Clear recovery and resume normal operation (user chose to keep defaults). */
  acceptDefaults(): void {
    this.recovery = null;
    this.save();
  }

  /** Apply MIGRATIONS stepwise v→v+1…, backing up before the first write. */
  private migrateForward(
    raw: Record<string, unknown>,
    fromVersion: number,
  ): Record<string, unknown> {
    this.backupSettings();
    let data = raw;
    let v = fromVersion;
    while (v < SETTINGS_SCHEMA_VERSION) {
      const step = MIGRATIONS[v];
      if (!step) throw new Error(`no migration path from schema v${v}`);
      data = step(data);
      v += 1;
    }
    data.schemaVersion = SETTINGS_SCHEMA_VERSION;
    // Write the migrated shape THROUGH the same atomic writer, then verify
    // it reads back as JSON before touching the original file.
    const tmpProbe = `${this.file}.migrate-probe`;
    fs.writeFileSync(tmpProbe, JSON.stringify(data, null, 2));
    try {
      JSON.parse(fs.readFileSync(tmpProbe, 'utf8'));
    } finally {
      try {
        fs.unlinkSync(tmpProbe);
      } catch {
        /* best effort */
      }
    }
    this.atomicWrite(this.file, JSON.stringify(data, null, 2));
    return data;
  }

  save() {
    // Recovery blocks normal saves: writing defaults over an unreadable or
    // newer file would destroy the user's only copy (spec Section 4.4).
    if (this.recovery) {
      throw new Error(
        `settings recovery pending (${this.recovery.reason}) — resolve via /api/setup/recover before saving`,
      );
    }
    this.atomicWrite(
      this.file,
      JSON.stringify({ ...this.settings, schemaVersion: SETTINGS_SCHEMA_VERSION }, null, 2),
    );
  }

  saveAnalytics() {
    this.atomicWrite(this.analyticsFile, JSON.stringify(this.analytics, null, 2));
  }

  recordUsage(model: string, input: number, output: number) {
    this.analytics.tokensIn += input;
    this.analytics.tokensOut += output;
    this.analytics.calls += 1;
    const m = this.analytics.byModel[model] ?? { in: 0, out: 0, calls: 0 };
    m.in += input;
    m.out += output;
    m.calls += 1;
    this.analytics.byModel[model] = m;
    this.saveAnalytics();
  }

  recordError() {
    this.analytics.errors += 1;
    this.saveAnalytics();
  }
}
