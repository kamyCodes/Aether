import React, { useEffect, useState } from 'react';
import { get } from '../lib/api';
import { ChevronRight, ChevronDown, Trash2 } from 'lucide-react';
import { useStore } from '../lib/store';
import type { AppSettings } from '../../shared/types';
import { GlassDropdown, GlassButton } from './glass';
import { ConfirmModal } from './ConfirmModal';
import { formatTime } from '../utils/dates';

/** Curated accent presets — quick one-click swatches beside the fine-tune input. */
const ACCENT_PRESETS = [
  '#6E62E5',
  '#7c9cff',
  '#5b9cf5',
  '#4cc38a',
  '#c084fc',
  '#f59e0b',
  '#f472b6',
  '#22d3ee',
];

const RUNTIME_DEFAULTS = { omniDefaultBaseUrl: '…' } as const;
let runtimeDefaults: typeof RUNTIME_DEFAULTS = { omniDefaultBaseUrl: '…' };

/** Placeholder is a resolved value from /api/config/runtime — the shared
 *  config module stays the single source of truth (no port literals here). */
async function loadRuntimeDefaults(): Promise<void> {
  try {
    runtimeDefaults = await get<typeof RUNTIME_DEFAULTS>('/config/runtime');
  } catch {
    /* server offline; keep the neutral placeholder */
  }
}
void loadRuntimeDefaults();

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const models = useStore((s) => s.models);
  const saveSettings = useStore((s) => s.saveSettings);
  const refreshModels = useStore((s) => s.refreshModels);
  const [draft, setDraft] = useState<AppSettings | null>(settings);

  if (!draft) return null;

  const setOmni = (patch: Partial<AppSettings['omni']>) =>
    setDraft({ ...draft, omni: { ...draft.omni, ...patch } });
  const setUi = (patch: Partial<AppSettings['ui']>) =>
    setDraft({ ...draft, ui: { ...draft.ui, ...patch } });
  const setPref = (k: keyof AppSettings['omni']['modelPrefs'], v: string) =>
    setDraft({
      ...draft,
      omni: { ...draft.omni, modelPrefs: { ...draft.omni.modelPrefs, [k]: v || undefined } },
    });

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" style={{ width: 640 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="panel-header">Settings</div>
        <div className="modal-results" style={{ padding: 4 }}>
          <div className="settings-form">
            <strong style={{ fontSize: 12 }}>Aether endpoint</strong>
            <label>
              Base URL (OpenAI-compatible)
              <input
                value={draft.omni.baseUrl}
                onChange={(e) => setOmni({ baseUrl: e.target.value })}
                placeholder={runtimeDefaults.omniDefaultBaseUrl}
              />
            </label>
            <label>
              API key (stored locally, sent only to your endpoint)
              <input
                type="password"
                value={draft.omni.apiKey}
                onChange={(e) => setOmni({ apiKey: e.target.value })}
                placeholder="(optional)"
              />
            </label>
            <div className="settings-row">
              <label>
                Timeout (ms)
                <input
                  type="number"
                  value={draft.omni.timeoutMs}
                  onChange={(e) => setOmni({ timeoutMs: Number(e.target.value) })}
                />
              </label>
              <label>
                Streaming
                <GlassDropdown
                  className="settings-dd btn-glass glass"
                  value={draft.omni.streaming ? 'on' : 'off'}
                  onValueChange={(v) => setOmni({ streaming: v === 'on' })}
                  ariaLabel="Streaming"
                  options={[
                    { value: 'on', label: 'on' },
                    { value: 'off', label: 'off' },
                  ]}
                />
              </label>
              <label>
                Fallback model
                <GlassDropdown
                  className="settings-dd btn-glass glass"
                  contentClassName="dd-content-scroll"
                  value={draft.omni.fallbackModel}
                  onValueChange={(v) => setOmni({ fallbackModel: v })}
                  ariaLabel="Fallback model"
                  options={[
                    { value: '', label: '(none)' },
                    ...models.map((m) => ({ value: m.id, label: m.id })),
                  ]}
                />
              </label>
            </div>
            <strong style={{ fontSize: 12 }}>Per-task model preferences</strong>
            <div className="settings-row">
              {(['chat', 'coding', 'planning', 'vision', 'debugging', 'testing'] as const).map(
                (k) => (
                  <label key={k} style={{ fontSize: 10 }}>
                    {k}
                    <GlassDropdown
                      className="settings-dd btn-glass glass"
                      contentClassName="dd-content-scroll"
                      value={draft.omni.modelPrefs[k] ?? ''}
                      onValueChange={(v) => setPref(k, v)}
                      ariaLabel={`${k} model preference`}
                      options={[
                        { value: '', label: '(default)' },
                        ...models.map((m) => ({ value: m.id, label: m.id })),
                      ]}
                    />
                  </label>
                ),
              )}
            </div>
            <strong style={{ fontSize: 12 }}>Appearance</strong>
            <div className="settings-row">
              <label>
                Theme
                <GlassDropdown
                  className="settings-dd btn-glass glass"
                  value={draft.ui.theme}
                  onValueChange={(v) => setUi({ theme: v as 'dark' | 'light' | 'oled' })}
                  ariaLabel="Theme"
                  options={[
                    { value: 'dark', label: 'dark' },
                    { value: 'light', label: 'light' },
                    { value: 'oled', label: 'OLED (true black)' },
                  ]}
                />
              </label>
              <label>
                Accent color
                <AccentPicker value={draft.ui.accent} onChange={(v) => setUi({ accent: v })} />
              </label>
              <label>
                Font size
                <input
                  type="number"
                  min={10}
                  max={20}
                  value={draft.ui.fontSize}
                  onChange={(e) => setUi({ fontSize: Number(e.target.value) })}
                />
              </label>
            </div>
            {/* Liquid Glass actions */}
            <div style={{ display: 'flex', gap: 8 }}>
              <GlassButton
                className="primary btn-glass glass"
                onClick={async () => {
                  await saveSettings(draft);
                  void refreshModels();
                  onClose();
                }}
              >
                Save
              </GlassButton>
              <GlassButton className="btn-glass glass" onClick={onClose}>
                Cancel
              </GlassButton>
              <GlassButton className="btn-glass glass" onClick={() => void refreshModels()}>
                Test connection
              </GlassButton>
              {/* Re-run the first-run wizard any time (spec Section 3.3) —
                  never a one-time-only first-run artifact. */}
              <GlassButton
                className="btn-glass glass"
                onClick={() => {
                  onClose();
                  window.dispatchEvent(new CustomEvent('aether:open-setup'));
                }}
              >
                Run setup again…
              </GlassButton>
            </div>
            <strong style={{ fontSize: 12 }}>Autonomy</strong>
            <div className="settings-row">
              <label>
                Mode
                <GlassDropdown
                  className="settings-dd settings-dd-wide btn-glass glass"
                  value={draft.agent?.autonomy?.mode ?? 'review'}
                  onValueChange={(v) =>
                    setDraft({
                      ...draft,
                      agent: {
                        autonomy: {
                          ...(draft.agent?.autonomy ?? {
                            mode: 'review',
                            allowPrefixes: [],
                            denyPrefixes: [],
                          }),
                          mode: v as 'secure' | 'review' | 'agent' | 'custom',
                        },
                      },
                    })
                  }
                  ariaLabel="Autonomy mode"
                  options={[
                    { value: 'secure', label: 'Secure — approve everything' },
                    { value: 'review', label: 'Review-driven (default)' },
                    { value: 'agent', label: 'Agent-driven — only destructive gated' },
                    { value: 'custom', label: 'Custom rules' },
                  ]}
                />
              </label>
            </div>
            {draft.agent?.autonomy?.mode === 'custom' && (
              <div className="settings-row">
                <label style={{ fontSize: 10 }}>
                  Allow prefixes (comma-separated)
                  <input
                    value={(draft.agent.autonomy.allowPrefixes ?? []).join(', ')}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        agent: {
                          autonomy: {
                            ...draft.agent.autonomy,
                            allowPrefixes: e.target.value
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean),
                          },
                        },
                      })
                    }
                    placeholder="npm test, git status"
                  />
                </label>
                <label style={{ fontSize: 10 }}>
                  Deny prefixes
                  <input
                    value={(draft.agent.autonomy.denyPrefixes ?? []).join(', ')}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        agent: {
                          autonomy: {
                            ...draft.agent.autonomy,
                            denyPrefixes: e.target.value
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean),
                          },
                        },
                      })
                    }
                    placeholder="rm, git push"
                  />
                </label>
              </div>
            )}
            <ModelHealthTable />
            <LogsSection />
            <DataWipeSection />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Models health table — per-model probe status from the background health
 * monitor, pushed live over the WebSocket (store.modelHealth) on every
 * probe/outcome change. Shows status, last probe time/latency, consecutive
 * failures, last error, and a LIVE per-second countdown to cooldown expiry —
 * the backend re-probes automatically when it hits zero, so recovery is
 * visible without touching anything.
 */
function ModelHealthTable() {
  const [open, setOpen] = useState(false);
  // Live health state — the backend broadcasts health:models on every change,
  // so cooldown expiries and re-probe results stream in without polling.
  const modelHealth = useStore((s) => s.modelHealth);
  const refreshHealth = useStore((s) => s.refreshHealth);
  // Re-render once per second while open so countdowns tick down live.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [open]);
  // Freshen from the server when the section opens (WS push covers the rest).
  useEffect(() => {
    if (open) void refreshHealth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const rows = Object.entries(modelHealth).sort(([a], [b]) => a.localeCompare(b));
  const failing = rows.filter(([, h]) => h.status === 'failing').length;
  const now = Date.now();
  const cooling = rows.filter(([, h]) => h.cooldownUntil && h.cooldownUntil > now).length;
  const [probing, setProbing] = useState(false);

  const fmtAge = (ts: number) => {
    if (!ts) return 'never';
    const s = Math.round((now - ts) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    return `${Math.round(s / 3600)}h ago`;
  };
  /** Precise m:ss countdown — the live value the user watches hit zero. */
  const fmtCooldown = (until?: number) => {
    if (!until) return null;
    const remain = Math.max(0, Math.round((until - now) / 1000));
    if (remain <= 0) return null;
    const m = Math.floor(remain / 60);
    const s = remain % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="settings-logs">
      <button className="settings-logs-head" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <strong style={{ fontSize: 12 }}>Models health</strong>
        {rows.length > 0 && (
          <span className="ac-process-badge">
            {rows.length - failing}/{rows.length} ok{cooling ? ` · ${cooling} cooling` : ''}
          </span>
        )}
      </button>
      {open && (
        <div className="settings-logs-body">
          {rows.length === 0 && (
            <div className="ac-note">
              No probes recorded yet — the monitor runs at startup and every 10 minutes.
            </div>
          )}
          {rows.length > 0 && (
            <table className="health-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Status</th>
                  <th>Last probe</th>
                  <th>Cooldown</th>
                  <th title="Last error from the most recent probe">Error</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([model, h]) => {
                  const coolingLeft = fmtCooldown(h.cooldownUntil);
                  // Cooldown deadline passed but the status still says failing:
                  // the automatic expiry probe is running right now.
                  const expiring =
                    h.cooldownUntil != null && h.cooldownUntil <= now && h.status === 'failing';
                  return (
                    <tr key={model}>
                      <td className="health-model" title={model}>
                        {model}
                      </td>
                      <td>
                        <span
                          className={`model-health-dot ${h.status === 'healthy' ? 'ok' : h.status === 'failing' ? 'failing' : 'unknown'}`}
                        />
                        {(h.consecutiveFailures ?? 0) > 1 && (
                          <span className="health-fails" title="consecutive failures">
                            ×{h.consecutiveFailures}
                          </span>
                        )}
                      </td>
                      <td
                        className="health-dim"
                        title={h.lastLatencyMs != null ? `${h.lastLatencyMs}ms` : undefined}
                      >
                        {fmtAge(h.lastChecked)}
                        {h.lastLatencyMs != null ? ` · ${h.lastLatencyMs}ms` : ''}
                      </td>
                      <td
                        className={`health-dim${coolingLeft ? ' health-countdown' : ''}`}
                        title={
                          coolingLeft
                            ? 'Cooldown — auto routing skips this model until it expires, then it is re-probed automatically'
                            : undefined
                        }
                      >
                        {coolingLeft
                          ? `${coolingLeft} left`
                          : expiring
                            ? 're-probing…'
                            : '—'}
                      </td>
                      <td className="health-err" title={h.lastError}>
                        {h.lastError ? h.lastError.slice(0, 60) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <button
            className="settings-reprobe"
            disabled={probing}
            onClick={() => {
              setProbing(true);
              void fetch('/api/health/models/refresh', { method: 'POST' })
                .then(() => refreshHealth())
                .catch(() => {
                  /* keep last known */
                })
                .finally(() => setProbing(false));
            }}
          >
            {probing ? 'Probing…' : 'Re-probe all models now'}
          </button>
        </div>
      )}
    </div>
  );
}

/** Collapsible activity log — where all the process noise lives now. */
function LogsSection() {
  const activity = useStore((s) => s.activity);
  const [open, setOpen] = useState(false);
  return (
    <div className="settings-logs">
      <button className="settings-logs-head" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <strong style={{ fontSize: 12 }}>Logs</strong>
        <span className="ac-process-badge">
          {activity.length} event{activity.length === 1 ? '' : 's'}
        </span>
      </button>
      {open && (
        <>
        <div className="settings-logs-body">
          {activity.length === 0 && <div className="ac-note">No activity yet.</div>}
          {activity.slice(0, 100).map((a, i) => (
            <div key={`${a.id}-${i}`} className={`settings-log-line ${a.status}`}>
              <span className="settings-log-time">{formatTime(a.ts)}</span>
              <span className="settings-log-label">{a.label}</span>
              {a.error && (
                <span className="settings-log-error" title={a.error}>
                  ⚠
                </span>
              )}
            </div>
          ))}
        </div>
          {activity.length > 0 && (
            <button
              className="settings-logs-clear"
              onClick={() => useStore.setState({ activity: [] })}
            >
              <Trash2 size={11} /> Clear log
            </button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Selective data wipe — lets the user choose which data categories to keep
 * before wiping the rest. Used for a clean reinstall without losing
 * everything (e.g. keep settings but wipe history + memory).
 */
const DATA_CATEGORIES = [
  { id: 'settings', label: 'Settings', desc: 'Theme, model prefs, autonomy mode' },
  { id: 'skills', label: 'Skills', desc: 'Built-in and imported skills' },
  { id: 'checkpoints', label: 'Checkpoints', desc: 'File snapshots before edits' },
  { id: 'permissions', label: 'Permissions', desc: 'Allow/deny command rules' },
  { id: 'memory', label: 'Memory', desc: 'Per-project agent memory' },
  { id: 'history', label: 'History', desc: 'Task transcripts and activity' },
  { id: 'health', label: 'Health', desc: 'Model health probe results' },
  { id: 'workspaces', label: 'Workspaces', desc: 'Registered project list' },
  { id: 'analytics', label: 'Analytics', desc: 'Token usage stats' },
  { id: 'chat-threads', label: 'Chat threads', desc: 'Saved conversations' },
] as const;

function DataWipeSection() {
  const [open, setOpen] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [wipeConfirm, setWipeConfirm] = useState(false);
  const wipeData = useStore((s) => s.wipeData);

  return (
    <div className="settings-wipe">
      <button className="settings-logs-head" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <strong style={{ fontSize: 12 }}>Wipe Data</strong>
        <span className="ac-process-badge" style={{ color: 'var(--err)' }}>
          destructive
        </span>
      </button>
      {open && (
        <div className="settings-wipe-body">
          <p className="ac-note" style={{ marginBottom: 8 }}>
            Select what to <strong>keep</strong> — everything else will be permanently deleted.
            This is like a clean reinstall without losing your essentials.
          </p>
          <div className="settings-wipe-grid">
            {DATA_CATEGORIES.map((cat) => (
              <label key={cat.id} className="settings-wipe-item">
                <input
                  type="checkbox"
                  checked={keep.has(cat.id)}
                  onChange={(e) => {
                    const next = new Set(keep);
                    if (e.target.checked) next.add(cat.id); else next.delete(cat.id);
                    setKeep(next);
                  }}
                />
                <span className="settings-wipe-label">{cat.label}</span>
                <span className="settings-wipe-desc">{cat.desc}</span>
              </label>
            ))}
          </div>
          <div className="settings-wipe-actions">
            <button
              className="settings-wipe-keepall"
              onClick={() => setKeep(new Set(DATA_CATEGORIES.map((c) => c.id)))}
            >
              Keep all
            </button>
            <button
              className="settings-wipe-keepnone"
              onClick={() => setKeep(new Set())}
            >
              Keep none
            </button>
            <div style={{ flex: 1 }} />
            <GlassButton
              className="settings-wipe-btn btn-glass glass"
              disabled={wiping}
              onClick={() => setWipeConfirm(true)}
            >
              <Trash2 size={12} />
              <span>{wiping ? 'Wiping…' : 'Wipe selected data'}</span>
            </GlassButton>
          </div>
        </div>
      )}
      <ConfirmModal
        open={wipeConfirm}
        title="Permanently delete data?"
        message={`This will remove ${keep.size === 0 ? 'ALL data' : `everything except ${[...keep].join(', ')}`} from ~/.aether. This cannot be undone.`}
        confirmLabel="Delete permanently"
        cancelLabel="Cancel"
        danger
        onConfirm={async () => {
          setWipeConfirm(false);
          setWiping(true);
          try {
            await wipeData([...keep]);
            setOpen(false);
          } finally {
            setWiping(false);
          }
        }}
        onCancel={() => setWipeConfirm(false)}
      />
    </div>
  );
}

/** Modern accent picker: preset swatches with live preview + a custom hex input. */
function AccentPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="accent-picker">
      <div className="accent-swatches">
        {ACCENT_PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            className={`accent-swatch ${value.toLowerCase() === c.toLowerCase() ? 'selected' : ''}`}
            style={{ background: c }}
            title={c}
            aria-label={`Set accent to ${c}`}
            onClick={() => onChange(c)}
          />
        ))}
      </div>
      <div className="accent-custom">
        <label className="accent-native" title="Pick any custom color">
          <span className="accent-native-dot" style={{ background: value }} />
          Custom…
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#6E62E5'}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
        <input
          className="accent-hex"
          value={value}
          onChange={(e) => {
            const v = e.target.value.trim();
            if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange(v);
          }}
          placeholder="#6E62E5"
          spellCheck={false}
        />
      </div>
    </div>
  );
}
