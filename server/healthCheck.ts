import fs from 'node:fs';
/**
 * HealthMonitor — periodic reachability/liveness checks for the model
 * gateway; surfaces degraded status to the UI status bar.
 */
import path from 'node:path';
import os from 'node:os';
import type { OmniSettings } from '../shared/types.js';
import type { OmniClient } from './omni.js';

/**
 * Background model-health monitor.
 *
 * Probes each configured model (modelPrefs + fallback + the routing
 * categories' defaults) with a genuinely minimal 1-token completion on a
 * schedule and at startup, recording per-model status to
 * ~/.aether/health.json so results survive restarts. Never runs in front
 * of a user task — a task in flight skips the probe round.
 */

export type HealthStatus = 'healthy' | 'failing' | 'unknown';

export interface ModelHealth {
  status: HealthStatus;
  lastChecked: number; // epoch ms
  lastLatencyMs?: number;
  lastError?: string;
  consecutiveFailures: number;
  /** Set while the cooldown exclusion is active (routing should skip it). */
  cooldownUntil?: number;
}

export interface HealthFile {
  models: Record<string, ModelHealth>;
  updatedAt: number;
}

const FILE = path.join(os.homedir(), '.aether', 'health.json');
const CHECK_INTERVAL_MS = 10 * 60 * 1000; // every 10 min (configurable via AETHER_HEALTH_INTERVAL_MS)
const COOLDOWN_MS = 15 * 60 * 1000; // exclusion window after repeated failures
const FAILURES_BEFORE_COOLDOWN = 3;

/** The models worth probing: everything the router could actually pick. */
export function modelsToProbe(settings: OmniSettings): string[] {
  const set = new Set<string>();
  for (const v of Object.values(settings.modelPrefs)) if (v) set.add(v);
  if (settings.fallbackModel) set.add(settings.fallbackModel);
  // Router category defaults (mirrors CATEGORY_PREFERENCES' primary entries).
  for (const m of ['auto/coding:free', 'auto/best-free', 'auto/chat', 'auto/vision']) set.add(m);
  return [...set];
}

export class HealthMonitor {
  private state: HealthFile = { models: {}, updatedAt: Date.now() };
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private omni: OmniClient,
    private getSettings: () => OmniSettings,
  ) {
    this.load();
  }

  private load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8')) as HealthFile;
      if (parsed && typeof parsed === 'object' && parsed.models) this.state = parsed;
    } catch {
      /* first run or unreadable — fresh state */
    }
  }

  private save() {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(this.state, null, 2));
    } catch {
      /* best-effort persistence */
    }
  }

  start() {
    if (this.timer) return;
    const interval =
      Number(process.env.AETHER_HEALTH_INTERVAL_MS) > 0
        ? Number(process.env.AETHER_HEALTH_INTERVAL_MS)
        : CHECK_INTERVAL_MS;
    // Startup probe after a grace period (let the server finish booting).
    setTimeout(() => void this.probeAll(), 5_000).unref?.();
    this.timer = setInterval(() => void this.probeAll(), interval);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  snapshot(): HealthFile {
    return this.state;
  }

  healthFor(model: string): ModelHealth {
    return (
      this.state.models[model] ?? { status: 'unknown', lastChecked: 0, consecutiveFailures: 0 }
    );
  }

  /** True when the model is in its post-failure cooldown window. */
  inCooldown(model: string): boolean {
    const h = this.healthFor(model);
    return !!(h.cooldownUntil && h.cooldownUntil > Date.now());
  }

  /** Record an outcome observed by real traffic (feeds the same cooldown). */
  recordOutcome(model: string, ok: boolean, note?: string) {
    const h = this.healthFor(model);
    h.lastChecked = Date.now();
    if (ok) {
      h.status = 'healthy';
      h.consecutiveFailures = 0;
      delete h.lastError;
      delete h.cooldownUntil;
    } else {
      h.consecutiveFailures += 1;
      h.status = h.consecutiveFailures >= FAILURES_BEFORE_COOLDOWN ? 'failing' : 'unknown';
      if (note) h.lastError = note.slice(0, 200);
      if (h.consecutiveFailures >= FAILURES_BEFORE_COOLDOWN)
        h.cooldownUntil = Date.now() + COOLDOWN_MS;
    }
    this.state.models[model] = h;
    this.state.updatedAt = Date.now();
    this.save();
  }

  /**
   * Probe one model with the cheapest possible request: max_tokens 1,
   * a single short message. Streams are disabled for the probe to get a
   * clean single response. Cost on paid tiers ≈ 1 output token.
   */
  async probeOne(model: string): Promise<ModelHealth> {
    const started = Date.now();
    let ok = false;
    let note: string | undefined;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30_000);
      const res = await fetch(`${this.omni.url('/chat/completions')}`, {
        method: 'POST',
        headers: this.omni.headers(),
        signal: ctrl.signal,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
          stream: false,
        }),
      });
      clearTimeout(t);
      ok = res.ok;
      if (!ok) note = `probe ${res.status}`;
      // Some gateways return 200 with an in-body error object.
      if (ok) {
        try {
          const body = (await res.json()) as { error?: unknown; choices?: unknown[] };
          if (body.error || !body.choices?.length) {
            ok = false;
            note = 'probe: empty/error body';
          }
        } catch {
          ok = false;
          note = 'probe: unparseable body';
        }
      }
    } catch (err) {
      ok = false;
      note = err instanceof Error ? err.message.slice(0, 120) : 'probe failed';
    }
    const h = this.healthFor(model);
    h.lastChecked = Date.now();
    h.lastLatencyMs = Date.now() - started;
    if (ok) {
      h.status = 'healthy';
      h.consecutiveFailures = 0;
      delete h.lastError;
      delete h.cooldownUntil;
    } else {
      h.consecutiveFailures += 1;
      h.status = 'failing';
      if (note) h.lastError = note;
      if (h.consecutiveFailures >= FAILURES_BEFORE_COOLDOWN)
        h.cooldownUntil = Date.now() + COOLDOWN_MS;
    }
    this.state.models[model] = h;
    this.state.updatedAt = Date.now();
    return h;
  }

  /** Probe every configured model, sequentially (cheap, low rate). */
  async probeAll(force = false): Promise<HealthFile> {
    if (this.running && !force) return this.state; // never stack probes
    this.running = true;
    try {
      for (const model of modelsToProbe(this.getSettings())) {
        await this.probeOne(model);
      }
      this.save();
    } finally {
      this.running = false;
    }
    return this.state;
  }
}
