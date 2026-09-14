import fs from 'node:fs';
import path from 'node:path';
import type { AppSettings, Analytics } from '../shared/types.js';
import { DATA_DIR } from './dataDir.js';
import { OMNI_DEFAULT_BASE_URL } from './config.js';

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
    autonomy: { mode: 'review', allowPrefixes: ['npm test', 'npm run', 'git status', 'git log', 'git diff'], denyPrefixes: [] },
  },
};

/** Blocking sleep — for in-process retry backoff (save paths are sync). */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export class SettingsStore {
  file = path.join(DATA_DIR, 'settings.json');
  analyticsFile = path.join(DATA_DIR, 'analytics.json');
  settings: AppSettings;
  analytics: Analytics = { tokensIn: 0, tokensOut: 0, calls: 0, errors: 0, byModel: {} };

  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    let loaded = this.readJson<Partial<AppSettings>>(this.file) ?? {};
    // Defensive: a hand-edited or old-schema file can carry a null branch
    // (e.g. "ui": null). Treat every branch as optional before spreading.
    if (typeof loaded !== 'object' || loaded === null || Array.isArray(loaded)) loaded = {};
    this.settings = {
      omni: { ...DEFAULTS.omni, ...loaded.omni, modelPrefs: { ...DEFAULTS.omni.modelPrefs, ...loaded.omni?.modelPrefs } },
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
        throw new Error(`settings read failed for ${file}: ${e instanceof Error ? e.message : String(e)}`);
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
              try { fs.unlinkSync(tmp); } catch { /* best effort */ }
              return;
            } catch (ce) {
              if (cAttempt >= 8) {
                throw new Error(`settings write failed for ${file}: ${(ce as NodeJS.ErrnoException).code ?? ''} ${ce instanceof Error ? ce.message : String(ce)}`);
              }
              sleepSync(10 * 2 ** cAttempt + Math.random() * 10);
            }
          }
        }
        sleepSync(10 * 2 ** attempt + Math.random() * 10);
      }
    }
  }

  save() {
    this.atomicWrite(this.file, JSON.stringify(this.settings, null, 2));
  }

  saveAnalytics() {
    this.atomicWrite(this.analyticsFile, JSON.stringify(this.analytics, null, 2));
  }

  recordUsage(model: string, input: number, output: number) {
    this.analytics.tokensIn += input;
    this.analytics.tokensOut += output;
    this.analytics.calls += 1;
    const m = this.analytics.byModel[model] ?? { in: 0, out: 0, calls: 0 };
    m.in += input; m.out += output; m.calls += 1;
    this.analytics.byModel[model] = m;
    this.saveAnalytics();
  }

  recordError() {
    this.analytics.errors += 1;
    this.saveAnalytics();
  }
}
