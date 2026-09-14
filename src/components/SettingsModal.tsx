import React, { useEffect, useState } from 'react';
import { get } from '../lib/api';
import { ChevronRight, ChevronDown, Trash2 } from 'lucide-react';
import { useStore } from '../lib/store';
import type { AppSettings } from '../../shared/types';
import { GlassDropdown, GlassButton } from './glass';
import { formatTime } from '../utils/dates';

/** Curated accent presets — quick one-click swatches beside the fine-tune input. */
const ACCENT_PRESETS = ['#6E62E5', '#7c9cff', '#5b9cf5', '#4cc38a', '#c084fc', '#f59e0b', '#f472b6', '#22d3ee'];

const RUNTIME_DEFAULTS = { omniDefaultBaseUrl: '…' } as const;
let runtimeDefaults: typeof RUNTIME_DEFAULTS = { omniDefaultBaseUrl: '…' };

/** Placeholder is a resolved value from /api/config/runtime — the shared
 *  config module stays the single source of truth (no port literals here). */
async function loadRuntimeDefaults(): Promise<void> {
  try { runtimeDefaults = await get<typeof RUNTIME_DEFAULTS>('/config/runtime'); } catch { /* server offline; keep the neutral placeholder */ }
}
void loadRuntimeDefaults();

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const models = useStore((s) => s.models);
  const saveSettings = useStore((s) => s.saveSettings);
  const refreshModels = useStore((s) => s.refreshModels);
  const [draft, setDraft] = useState<AppSettings | null>(settings);

  if (!draft) return null;

  const setOmni = (patch: Partial<AppSettings['omni']>) => setDraft({ ...draft, omni: { ...draft.omni, ...patch } });
  const setUi = (patch: Partial<AppSettings['ui']>) => setDraft({ ...draft, ui: { ...draft.ui, ...patch } });
  const setPref = (k: keyof AppSettings['omni']['modelPrefs'], v: string) =>
    setDraft({ ...draft, omni: { ...draft.omni, modelPrefs: { ...draft.omni.modelPrefs, [k]: v || undefined } } });

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" style={{ width: 640 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="panel-header">Settings</div>
        <div className="modal-results" style={{ padding: 4 }}>
          <div className="settings-form">
            <strong style={{ fontSize: 12 }}>Aether endpoint</strong>
            <label>Base URL (OpenAI-compatible)
              <input value={draft.omni.baseUrl} onChange={(e) => setOmni({ baseUrl: e.target.value })} placeholder={runtimeDefaults.omniDefaultBaseUrl} />
            </label>
            <label>API key (stored locally, sent only to your endpoint)
              <input type="password" value={draft.omni.apiKey} onChange={(e) => setOmni({ apiKey: e.target.value })} placeholder="(optional)" />
            </label>
            <div className="settings-row">
              <label>Timeout (ms)
                <input type="number" value={draft.omni.timeoutMs} onChange={(e) => setOmni({ timeoutMs: Number(e.target.value) })} />
              </label>
              <label>Streaming
                <GlassDropdown
                  className="settings-dd btn-glass glass"
                  value={draft.omni.streaming ? 'on' : 'off'}
                  onValueChange={(v) => setOmni({ streaming: v === 'on' })}
                  ariaLabel="Streaming"
                  options={[{ value: 'on', label: 'on' }, { value: 'off', label: 'off' }]}
                />
              </label>
              <label>Fallback model
                <GlassDropdown
                  className="settings-dd btn-glass glass"
                  contentClassName="dd-content-scroll"
                  value={draft.omni.fallbackModel}
                  onValueChange={(v) => setOmni({ fallbackModel: v })}
                  ariaLabel="Fallback model"
                  options={[{ value: '', label: '(none)' }, ...models.map((m) => ({ value: m.id, label: m.id }))]}
                />
              </label>
            </div>
            <strong style={{ fontSize: 12 }}>Per-task model preferences</strong>
            <div className="settings-row">
              {(['chat', 'coding', 'planning', 'vision', 'debugging', 'testing'] as const).map((k) => (
                <label key={k} style={{ fontSize: 10 }}>
                  {k}
                  <GlassDropdown
                    className="settings-dd btn-glass glass"
                    contentClassName="dd-content-scroll"
                    value={draft.omni.modelPrefs[k] ?? ''}
                    onValueChange={(v) => setPref(k, v)}
                    ariaLabel={`${k} model preference`}
                    options={[{ value: '', label: '(default)' }, ...models.map((m) => ({ value: m.id, label: m.id }))]}
                  />
                </label>
              ))}
            </div>
            <strong style={{ fontSize: 12 }}>Appearance</strong>
            <div className="settings-row">
              <label>Theme
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
              <label>Accent color
                <AccentPicker value={draft.ui.accent} onChange={(v) => setUi({ accent: v })} />
              </label>
              <label>Font size
                <input type="number" min={10} max={20} value={draft.ui.fontSize} onChange={(e) => setUi({ fontSize: Number(e.target.value) })} />
              </label>
            </div>
            {/* Liquid Glass actions */}
            <div style={{ display: 'flex', gap: 8 }}>
              <GlassButton className="primary btn-glass glass" onClick={async () => { await saveSettings(draft); void refreshModels(); onClose(); }}>Save</GlassButton>
              <GlassButton className="btn-glass glass" onClick={onClose}>Cancel</GlassButton>
              <GlassButton className="btn-glass glass" onClick={() => void refreshModels()}>Test connection</GlassButton>
            </div>
            <strong style={{ fontSize: 12 }}>Autonomy</strong>
            <div className="settings-row">
              <label>Mode
                <GlassDropdown
                  className="settings-dd settings-dd-wide btn-glass glass"
                  value={draft.agent?.autonomy?.mode ?? 'review'}
                  onValueChange={(v) => setDraft({ ...draft, agent: { autonomy: { ...(draft.agent?.autonomy ?? { mode: 'review', allowPrefixes: [], denyPrefixes: [] }), mode: v as 'secure' | 'review' | 'agent' | 'custom' } } })}
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
                <label style={{ fontSize: 10 }}>Allow prefixes (comma-separated)
                  <input value={(draft.agent.autonomy.allowPrefixes ?? []).join(', ')} onChange={(e) => setDraft({ ...draft, agent: { autonomy: { ...draft.agent.autonomy, allowPrefixes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } } })} placeholder="npm test, git status" />
                </label>
                <label style={{ fontSize: 10 }}>Deny prefixes
                  <input value={(draft.agent.autonomy.denyPrefixes ?? []).join(', ')} onChange={(e) => setDraft({ ...draft, agent: { autonomy: { ...draft.agent.autonomy, denyPrefixes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } } })} placeholder="rm, git push" />
                </label>
              </div>
            )}
            <ModelHealthTable />
            <LogsSection />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Models health table — per-model probe status from the background health
 * monitor (~/.aether/health.json via /api/health/models). Shows status,
 * last probe time/latency, consecutive failures, last error, and the active
 * cooldown expiry so a cooled-down route is explainable at a glance.
 * Read-only: refreshes on mount and via the Refresh button; the "Test
 * connection" button above triggers a full on-demand re-probe.
 */
function ModelHealthTable() {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<{ models: Record<string, { status: string; lastChecked: number; lastLatencyMs?: number; lastError?: string; consecutiveFailures: number; cooldownUntil?: number }> } | null>(null);

  useEffect(() => {
    if (!open || snapshot) return;
    void fetch('/api/health/models').then((r) => r.json()).then(setSnapshot).catch(() => setSnapshot({ models: {} }));
  }, [open, snapshot]);

  const rows = snapshot
    ? Object.entries(snapshot.models).sort(([a], [b]) => a.localeCompare(b))
    : [];
  const failing = rows.filter(([, h]) => h.status === 'failing').length;
  const cooling = rows.filter(([, h]) => h.cooldownUntil && h.cooldownUntil > Date.now()).length;

  const fmtAge = (ts: number) => {
    if (!ts) return 'never';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    return `${Math.round(s / 3600)}h ago`;
  };
  const fmtCooldown = (until?: number) => {
    if (!until) return null;
    const remain = Math.round((until - Date.now()) / 1000);
    if (remain <= 0) return null;
    return remain < 60 ? `${remain}s` : `${Math.ceil(remain / 60)}m`;
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
          {!snapshot && <div className="ac-note">Loading health data…</div>}
          {snapshot && rows.length === 0 && <div className="ac-note">No probes recorded yet — the monitor runs at startup and every 10 minutes.</div>}
          {rows.length > 0 && (
            <table className="health-table">
              <thead>
                <tr><th>Model</th><th>Status</th><th>Last probe</th><th>Cooldown</th><th title="Last error from the most recent probe">Error</th></tr>
              </thead>
              <tbody>
                {rows.map(([model, h]) => {
                  const coolingLeft = fmtCooldown(h.cooldownUntil);
                  return (
                    <tr key={model}>
                      <td className="health-model" title={model}>{model}</td>
                      <td>
                        <span className={`model-health-dot ${h.status === 'healthy' ? 'ok' : h.status === 'failing' ? 'failing' : 'unknown'}`} />
                        {h.consecutiveFailures > 1 && <span className="health-fails" title="consecutive failures">×{h.consecutiveFailures}</span>}
                      </td>
                      <td className="health-dim" title={h.lastLatencyMs != null ? `${h.lastLatencyMs}ms` : undefined}>{fmtAge(h.lastChecked)}{h.lastLatencyMs != null ? ` · ${h.lastLatencyMs}ms` : ''}</td>
                      <td className="health-dim">{coolingLeft ? `${coolingLeft} left` : '—'}</td>
                      <td className="health-err" title={h.lastError}>{h.lastError ? h.lastError.slice(0, 60) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <button
            className="settings-logs-clear"
            onClick={() => { setSnapshot(null); void fetch('/api/health/models/refresh', { method: 'POST' }).then((r) => r.json()).then((j) => setSnapshot(j)).catch(() => setSnapshot({ models: {} })); }}
          >
            Re-probe all models now
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
        <span className="ac-process-badge">{activity.length} event{activity.length === 1 ? '' : 's'}</span>
      </button>
      {open && (
        <div className="settings-logs-body">
          {activity.length === 0 && <div className="ac-note">No activity yet.</div>}
          {activity.slice(0, 100).map((a, i) => (
            <div key={`${a.id}-${i}`} className={`settings-log-line ${a.status}`}>
              <span className="settings-log-time">{formatTime(a.ts)}</span>
              <span className="settings-log-label">{a.label}</span>
              {a.error && <span className="settings-log-error" title={a.error}>⚠</span>}
            </div>
          ))}
          {activity.length > 0 && (
            <button className="settings-logs-clear" onClick={() => useStore.setState({ activity: [] })}>
              <Trash2 size={11} /> Clear log
            </button>
          )}
        </div>
      )}
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
          onChange={(e) => { const v = e.target.value.trim(); if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange(v); }}
          placeholder="#6E62E5"
          spellCheck={false}
        />
      </div>
    </div>
  );
}
