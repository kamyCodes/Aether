import React from 'react';
import { GitBranch, CircleOff, Loader2, Sun, Moon, MonitorOff } from 'lucide-react';
import { useStore } from '../lib/store';

const THEME_CYCLE = { dark: 'light', light: 'oled', oled: 'dark' } as const;

export function StatusBar() {
  const omniConnected = useStore((s) => s.omniConnected);
  const omniError = useStore((s) => s.omniError);
  const wsStatus = useStore((s) => s.wsStatus);
  const chatModel = useStore((s) => s.chatModel || s.selectedModel);
  const tasks = useStore((s) => s.tasks);
  const settings = useStore((s) => s.settings);
  const workspaces = useStore((s) => s.workspaces);
  const workspaceId = useStore((s) => s.workspaceId);
  const gitBranch = useStore((s) => s.gitBranch);
  // Count only this workspace's runs — the status line describes the
  // workspace session you're in, not every project with a live task.
  const running = tasks.filter(
    (t) =>
      t.workspaceId === workspaceId &&
      (t.status === 'running' || t.status === 'planning'),
  ).length;

  const wsName = workspaces.find((w) => w.id === workspaceId)?.name;
  // Live-update health: while the WebSocket is down, task/model/terminal
  // events can't arrive — say so loudly instead of letting the UI look alive
  // while silently going stale. The store auto-retries every 2s.
  const wsDown = wsStatus !== 'open';

  const theme = settings?.ui.theme ?? 'dark';
  const themeLabel = theme === 'oled' ? 'OLED (true black)' : theme;
  const ThemeIcon = theme === 'light' ? Sun : theme === 'oled' ? MonitorOff : Moon;

  return (
    <div className="status-line">
      <span className="status-item" title="Current workspace">
        {wsName ?? 'No workspace'}
      </span>
      {gitBranch ? (
        <span className="status-item status-branch" title="Current git branch (read-only display)">
          <GitBranch size={11} /> {gitBranch}
        </span>
      ) : (
        <span
          className="status-item status-branch status-norepo"
          title="No git repository connected in this workspace"
        >
          <CircleOff size={11} /> no version control
        </span>
      )}
      <span className="status-sep">·</span>
      <span
        className="status-item"
        title={
          omniConnected
            ? 'AI endpoint reachable'
            : `AI endpoint unreachable${omniError ? `: ${omniError.slice(0, 80)}` : ''}`
        }
      >
        {/* Connection state uses ONLY fixed semantic colors: green =
            connected, red = offline, yellow (pulsing) = connecting —
            never the accent. */}
        <span
          className={`conn-dot ${
            omniConnected ? 'ok' : wsStatus === 'connecting' ? 'connecting' : 'bad'
          }`}
        />{' '}
        Aether{' '}
        {omniConnected
          ? 'connected'
          : wsStatus === 'connecting'
            ? 'connecting…'
            : 'offline'}
      </span>
      <span className="status-sep">·</span>
      <span
        className={`status-item${wsDown ? ' ws-pill' : ''}`}
        title={
          wsDown
            ? 'Live updates interrupted — the app is reconnecting automatically (every 2s). Task, model, and terminal streams are paused until it succeeds.'
            : `WebSocket to the local server: ${wsStatus}`
        }
      >
        {wsDown && <Loader2 size={11} className="spin" />}
        {wsDown ? (wsStatus === 'connecting' ? 'Connecting…' : 'Reconnecting…') : `WS ${wsStatus}`}
      </span>
      <span className="status-sep">·</span>
      <span className="status-item" title="Model used for chat and agent tasks">
        {chatModel || (omniConnected ? 'auto route' : 'no model')}
      </span>
      {running > 0 && (
        <>
          <span className="status-sep">·</span>
          <span
            className="status-item"
            style={{ color: 'var(--warn)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
            title={`${running} agent task${running > 1 ? 's' : ''} running`}
          >
            <Loader2 size={11} className="spin" /> {running} running
          </span>
        </>
      )}
      <div className="spacer" style={{ flex: 1 }} />
      <button
        className="theme-toggle-btn"
        title={`Theme: ${themeLabel} — click to cycle dark → light → OLED`}
        onClick={() => {
          const st = useStore.getState();
          const s = st.settings;
          if (s)
            void st.saveSettings({
              ...s,
              ui: { ...s.ui, theme: THEME_CYCLE[s.ui.theme] ?? 'dark' },
            });
        }}
      >
        <ThemeIcon size={11} /> <span>{theme}</span>
      </button>
    </div>
  );
}
