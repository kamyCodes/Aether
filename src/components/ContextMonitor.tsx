import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { get, post } from '../lib/api';
import type { ContextReport } from '../../shared/types';

/** Compact token formatting: 96k / 1.0m / 570k (like the reference design). */
function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}m`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

const SIZE = 34;
const STROKE = 3;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

/**
 * Context viewer — a circular button (SVG progress ring + percentage) pinned
 * at the bottom-right of the right panel. Hovering it floats the detail card
 * above it as a popover:
 *
 *   ┌──────────────────────────────┐
 *   │ Context      96k / 1.0m · 10%│
 *   │ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬           │
 *   │ Compacts at            400k  │
 *   │ ──────────────────────────   │
 *   │ Thread usage           100m  │
 *   │ Input                   99m  │
 *   │ Cached input (included) 91m  │
 *   │ Output                 570k  │
 *   └──────────────────────────────┘
 *                              ◔ 10%   ← circular trigger
 */
export function ContextMonitor() {
  const context = useStore((s) => s.context);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Last usage we saw, so we can detect the moment usage crosses the
  // compaction threshold (fire once per crossing, not on every poll).
  const flashTimer = useRef<number | null>(null);
  // Hysteresis state: true while a future crossing should fire. Starts as
  // 'will fire if already over' so a page load into an over-threshold
  // workspace still warns once.
  const rearmed = useRef(true);

  useEffect(() => {
    const t = setInterval(() => {
      void get<ContextReport>('/context').then((c) => useStore.setState({ context: c })).catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, []);

  // Warning: when usage crosses the compaction threshold, auto-open the card
  // and flash it for a few seconds. Fires only on the crossing edge — and
  // hysteresis keeps oscillation near the line from retriggering: once fired,
  // the alert re-arms only after usage falls 2 points BELOW the threshold,
  // so hovering around 79–81% flashes once, not on every poll.
  const HYSTERESIS_PCT = 2;
  useEffect(() => {
    if (!context) return;
    const pct = (context.used / context.contextWindow) * 100;
    const threshold = (context.compactAtPct ?? 80);
    // Fire only while armed: a crossing that happens while disarmed (inside
    // the hysteresis band) is ignored.
    if (rearmed.current && pct >= threshold) {
      rearmed.current = false;
      setOpen(true);
      setFlashing(true);
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlashing(false), 6000);
    }
    // Re-arm only when usage is clearly back below the threshold (minus the
    // hysteresis band) — e.g. after a reset or compaction.
    if (!rearmed.current && pct < threshold - HYSTERESIS_PCT) {
      rearmed.current = true;
      if (flashTimer.current) { window.clearTimeout(flashTimer.current); flashTimer.current = null; }
      setFlashing(false);
    }
  }, [context]);
  useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current); }, []);

  // Keep open while the pointer is over the button OR the floating card
  // (card is a sibling inside wrapRef, so one contains() check covers both).
  const leaveTimer = useRef<number | null>(null);
  const armClose = () => {
    if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => setOpen(false), 180);
  };
  const cancelClose = () => {
    if (leaveTimer.current) { window.clearTimeout(leaveTimer.current); leaveTimer.current = null; }
  };
  useEffect(() => () => { if (leaveTimer.current) window.clearTimeout(leaveTimer.current); }, []);

  // Click pins/unpins the card open (ignores hover); Escape unpins.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPinned(false); setOpen(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!context) return null;
  const pct = Math.min(100, (context.used / context.contextWindow) * 100);
  const compactAt = context.compactAtPct ?? 80;
  const compactTokens = Math.round((context.contextWindow * compactAt) / 100);
  const tu = context.threadUsage;
  const ringColor = pct > 85 ? 'var(--err)' : pct > 60 ? 'var(--warn)' : 'var(--accent)';
  const overThreshold = pct >= compactAt;

  return (
    <div
      ref={wrapRef}
      className="ctx-wrap"
      style={{ position: 'relative', flexShrink: 0, display: 'flex', justifyContent: 'flex-end', padding: '6px 10px', borderTop: '1px solid var(--border)' }}
    >
      {/* Floating detail card (hover popover). Hover handlers live here and
          on the FAB only — NOT on the wrapper row, which spans the full panel
          width and would open the card when hovering anywhere on that line. */}
      {open && (
        <div
          className={`ctx-detail fade-in ${flashing ? 'ctx-alert' : ''}`}
          onMouseEnter={cancelClose}
          onMouseLeave={pinned ? undefined : armClose}
        >
          <div className="ctx-row ctx-strong">
            <span className="ctx-label">Context</span>
            <span className="ctx-value">
              {fmt(context.used)} / {fmt(context.contextWindow)} · {Math.round(pct)}%
            </span>
          </div>
          <div className="context-bar" style={{ marginTop: 6 }}>
            <div className="context-bar-fill" style={{ transform: `scaleX(${pct / 100})`, background: ringColor }} />
          </div>

          <div className="ctx-row" style={{ marginTop: 8 }}>
            <span className="ctx-label">Compacts at</span>
            <span className="ctx-value">{fmt(compactTokens)}</span>
          </div>

          {tu && (
            <>
              <div className="ctx-sep" />
              <div className="ctx-row ctx-strong">
                <span className="ctx-label">Thread usage</span>
                <span className="ctx-value">{fmt(tu.input + tu.output)}</span>
              </div>
              <div className="ctx-row">
                <span className="ctx-label">Input</span>
                <span className="ctx-value">{fmt(tu.input)}</span>
              </div>
              <div className="ctx-row">
                <span className="ctx-label">Cached input (included)</span>
                <span className="ctx-value">{fmt(tu.cachedInput)}</span>
              </div>
              <div className="ctx-row">
                <span className="ctx-label">Output</span>
                <span className="ctx-value">{fmt(tu.output)}</span>
              </div>
              <div className="ctx-note">
                {context.exact
                  ? `Cumulative provider-reported usage across ${tu.calls} call${tu.calls === 1 ? '' : 's'} in the current thread transcript.`
                  : 'Cumulative usage across the current thread — provider-reported when available.'}
              </div>
            </>
          )}
          {!tu && (
            <div className="ctx-note">No provider usage reported yet — run a task or send a chat message.</div>
          )}

          <div className="ctx-sep" />
          <div className="ctx-rows">
            <span>System</span><span>{fmt(context.breakdown.system)}</span>
            <span>Files</span><span>{fmt(context.breakdown.files)}</span>
            <span>Chat</span><span>{fmt(context.breakdown.chat)}</span>
            <span>Tools</span><span>{fmt(context.breakdown.tools)}</span>
            <span>Skills</span><span>{fmt(context.breakdown.skills)}</span>
          </div>
          <div className="ctx-note" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1 }}>
              {context.exact ? 'Exact usage from the provider.' : 'Estimated (~4 chars/token) — provider did not report usage.'}
            </span>
            <button onClick={(e) => { e.stopPropagation(); void post('/context/reset').then(() => useStore.getState().refreshContext()); }}>Reset</button>
          </div>

          {context.files.length > 0 && (
            <div className="ctx-files">
              {context.files.map((f) => (
                <div key={f.path} className="ctx-file-row">
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.pinned ? '📌 ' : ''}{f.path}</span>
                  <span style={{ color: 'var(--text-faint)' }}>{fmt(f.tokens)} tok</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Circular trigger: progress ring + percentage */}
      <button
        className={`ctx-fab ${open ? 'open' : ''} ${flashing ? 'ctx-alert' : ''}`}
        title={`Context: ${fmt(context.used)} / ${fmt(context.contextWindow)} (${Math.round(pct)}%) — hover for details`}
        aria-label="Context usage"
        onMouseEnter={() => { cancelClose(); setOpen(true); }}
        onMouseLeave={pinned ? undefined : armClose}
        onClick={() => { const next = !pinned; setPinned(next); setOpen(next); }}
      >
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--border)" strokeWidth={STROKE} />
          <circle
            cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none"
            stroke={ringColor}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - pct / 100)}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            style={{ transition: 'stroke-dashoffset 0.4s ease, stroke 0.2s ease' }}
          />
        </svg>
        <span className="ctx-fab-label">{Math.round(pct)}%</span>
      </button>
    </div>
  );
}
