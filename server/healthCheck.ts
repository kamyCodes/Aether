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
  /** One-shot probe timer per model — fires when its cooldown expires so the
   *  model is re-checked (and cleared or re-cooled) automatically. */
  private cooldownTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Notified on every state change — the WS layer broadcasts to clients. */
  onUpdate: (() => void) | null = null;

  constructor(
    private omni: OmniClient,
    private getSettings: () => OmniSettings,
  ) {
    this.load();
    // Persisted cooldowns from a previous run still have live deadlines:
    // schedule their expiry probes so a restart doesn't strand a model in
    // cooldown until the next full probe round.
    const now = Date.now();
    for (const [model, h] of Object.entries(this.state.models)) {
      if (h.cooldownUntil && h.cooldownUntil > now) this.scheduleExpiryProbe(model, h.cooldownUntil);
    }
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
    for (const t of this.cooldownTimers.values()) clearTimeout(t);
    this.cooldownTimers.clear();
  }

  /** Arm the one-shot probe that fires when this model's cooldown expires.
   *  A healthy result clears the cooldown; a failing one re-arms it (and
   *  this method runs again), so recovery is fully automatic. */
  private scheduleExpiryProbe(model: string, cooldownUntil: number) {
    const prev = this.cooldownTimers.get(model);
    if (prev) clearTimeout(prev);
    const delay = Math.max(0, cooldownUntil - Date.now());
    const t = setTimeout(
      () => {
        this.cooldownTimers.delete(model);
        void this.probeOne(model).catch(() => {
          /* probe errors are recorded internally */
        });
      },
      // Unref: an idle backend must not be kept alive by a pending probe.
      delay,
    );
    t.unref?.();
    this.cooldownTimers.set(model, t);
  }

  /** Notify subscribers (WS broadcast) that health state changed. */
  private notify() {
    try {
      this.onUpdate?.();
    } catch {
      /* subscriber errors must not break the monitor */
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
    this.notify();
    // Real traffic just failed the model into cooldown — arm its expiry probe
    if (h.cooldownUntil) this.scheduleExpiryProbe(model, h.cooldownUntil);
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
      if (h.consecutiveFailures >= FAILURES_BEFORE_COOLDOWN) {
        h.cooldownUntil = Date.now() + COOLDOWN_MS;
        this.scheduleExpiryProbe(model, h.cooldownUntil);
      }
    }
    this.state.models[model] = h;
    this.state.updatedAt = Date.now();
    this.save();
    this.notify();
    return h;
  }

  /** Probe every configured model, sequentially (cheap, low rate).
   *  Skips (without force):
   *   - models in their post-failure cooldown — a probe would only fail
   *     again and re-arm the 15-minute timer ("don't re-probe immediately");
   *   - models probed very recently (fresh entry from the previous run's
   *     persisted health.json, real-traffic outcomes, or another surface) —
   *     the normal cadence picks them up on the next round.
   *  force=true (manual "Re-probe all models now") bypasses both skips. */
  async probeAll(force = false): Promise<HealthFile> {
    if (this.running && !force) return this.state; // never stack probes
    this.running = true;
    try {
      const now = Date.now();
      for (const model of modelsToProbe(this.getSettings())) {
        const h = this.healthFor(model);
        if (!force) {
          if (h.cooldownUntil && h.cooldownUntil > now) continue;
          if (now - h.lastChecked < CHECK_INTERVAL_MS / 2) continue;
        }
        await this.probeOne(model);
      }
      this.save();
    } finally {
      this.running = false;
    }
    return this.state;
  }
}
