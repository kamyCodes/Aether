import React, { useEffect, useState } from 'react';
import { GitBranch, GitBranchPlus, X, Sparkles, CircleDot } from 'lucide-react';
import { useStore } from '../lib/store';
import { get, post } from '../lib/api';
import type { FileDiff } from '../../shared/types';
import { formatDateTime } from '../utils/dates';

interface GitStatus {
  files: { path: string; status: string }[];
  branches: string[];
  current: string;
  isRepo?: boolean;
  error?: string;
}
interface Commit {
  oid: string;
  message: string;
  author: string;
  timestamp: number;
}

export function GitPanel() {
  const workspaceId = useStore((s) => s.workspaceId);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [log, setLog] = useState<Commit[]>([]);
  const [message, setMessage] = useState('');
  const [diffPath, setDiffPath] = useState<string | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [busy, setBusy] = useState(false);
  const [initializing, setInitializing] = useState(false);

  async function refresh() {
    if (!workspaceId) return;
    try {
      const st = await get<GitStatus>(`/workspaces/${workspaceId}/git/status`);
      setStatus(st);
      setLog((await get<{ commits: Commit[] }>(`/workspaces/${workspaceId}/git/log`)).commits);
    } catch {
      setStatus({ files: [], branches: [], current: '', isRepo: false });
    }
  }

  useEffect(() => {
    void refresh(); /* eslint-disable-next-line */
  }, [workspaceId]);

  async function initRepo() {
    if (!workspaceId) return;
    setInitializing(true);
    try {
      await post(`/workspaces/${workspaceId}/git/init`, {});
      await refresh();
      useStore.getState().showToast('Git repository initialized');
    } finally {
      setInitializing(false);
    }
  }

  // Not a repository (or version control unavailable): say so plainly and
  // offer the one-click fix — never a silent empty panel.
  if (status && !status.current && !status.files.length && status.branches.length === 0) {
    const isNoRepo = !status.isRepo || (status.error ?? '').length > 0;
    if (isNoRepo) {
      return (
        <div className="panel-body" style={{ padding: 10, display: 'flex', gap: 12 }}>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              textAlign: 'center',
            }}
          >
            <GitBranch size={28} style={{ color: 'var(--text-faint)' }} />
            <strong>No repository</strong>
            <div style={{ fontSize: 11.5, color: 'var(--text-dim)', maxWidth: 320 }}>
              This folder has no version control connected. Initialize a git repository to track
              changes, review diffs, and let the agent commit safely.
            </div>
            <button
              className="primary"
              onClick={() => void initRepo()}
              disabled={initializing}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <GitBranchPlus size={13} /> {initializing ? 'Initializing…' : 'Initialize repository'}
            </button>
          </div>
        </div>
      );
    }
  }

  async function viewDiff(p: string) {
    if (!workspaceId) return;
    setDiffPath(p);
    setDiff(
      await get<FileDiff>(`/workspaces/${workspaceId}/git/diff?path=${encodeURIComponent(p)}`),
    );
  }

  async function aiMessage() {
    if (!workspaceId || !status?.files.length) return;
    setBusy(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            {
              role: 'user',
              content: `Write a concise conventional git commit message (one line) for these changes:\n${status.files.map((f) => `${f.status} ${f.path}`).join('\n')}\n\nRespond with ONLY the commit message.`,
            },
          ],
          skillsEnabled: false,
        }),
      });
      const text = await res.text();
      const done = text.match(/"type":"done","text":"((?:[^"\\]|\\.)*)"/);
      let msg = '';
      if (done) {
        try {
          msg = JSON.parse(`"${done[1]}"`);
        } catch {
          /* keep */
        }
      }
      setMessage(msg.trim() || 'chore: update files');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel-body" style={{ padding: 10, display: 'flex', gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            marginBottom: 8,
            flexWrap: 'wrap',
          }}
        >
          <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <GitBranch size={13} /> {status?.current || 'No version control'}
          </strong>
          <div style={{ flex: 1 }} />
          <select
            style={{ fontSize: 11 }}
            defaultValue=""
            onChange={async (e) => {
              if (e.target.value && workspaceId) {
                await post(`/workspaces/${workspaceId}/git/checkout`, { ref: e.target.value });
                void refresh();
              }
            }}
          >
            <option value="">branches…</option>
            {status?.branches.map((b) => (
              <option key={b} value={b}>
                {b === status.current ? `${b} (current)` : b}
              </option>
            ))}
          </select>
        </div>

        {status?.files.map((f) => (
          <div
            key={f.path}
            className="result-item"
            onClick={() => void viewDiff(f.path)}
            style={{ cursor: 'pointer' }}
          >
            <span className={`badge ${f.status === 'added' ? 'on' : ''}`}>{f.status}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.path}</span>
          </div>
        ))}
        {status && status.files.length === 0 && (
          <div className="empty-state">Working tree clean.</div>
        )}

        <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
          <input
            style={{ flex: 1 }}
            placeholder="Commit message…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <button onClick={() => void aiMessage()} disabled={busy}>
            {busy ? (
              '…'
            ) : (
              <>
                <Sparkles size={12} className="icon-warn" /> AI
              </>
            )}
          </button>
          <button
            className="primary"
            disabled={!message.trim() || !status?.files.length}
            onClick={async () => {
              if (!workspaceId) return;
              await post(`/workspaces/${workspaceId}/git/commit`, { message });
              setMessage('');
              void refresh();
            }}
          >
            Commit
          </button>
        </div>

        <div className="palette-section" style={{ marginTop: 12 }}>
          History
        </div>
        {log.map((c) => (
          <div
            key={c.oid}
            className="result-item"
            style={{ flexDirection: 'column', alignItems: 'flex-start' }}
          >
            <div style={{ fontSize: 12 }}>{c.message.split('\n')[0]}</div>
            <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>
              {c.author} · {formatDateTime(c.timestamp)} · {c.oid.slice(0, 7)}
            </div>
          </div>
        ))}
      </div>

      {diff && (
        <div
          style={{
            flex: 1.4,
            minWidth: 0,
            border: '1px solid var(--border)',
            borderRadius: 6,
            overflow: 'auto',
          }}
          className="diff-view"
        >
          <div className="diff-file-head">
            <strong>{diffPath}</strong>
            <span style={{ color: 'var(--ok)' }}>+{diff.additions}</span>
            <span style={{ color: 'var(--err)' }}>−{diff.deletions}</span>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => {
                setDiff(null);
                setDiffPath(null);
              }}
              title="Close diff"
            >
              <X size={13} />
            </button>
          </div>
          {diff.hunks.map((h, hi) => (
            <div key={hi}>
              {h.lines.map((l, li) => (
                <div key={li} className={`diff-line ${l.type}`}>
                  <span className="ln">{l.old > 0 ? l.old : l.new > 0 ? l.new : ''}</span>
                  <span className="sign">
                    {l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '}
                  </span>
                  <span style={{ whiteSpace: 'pre-wrap' }}>{l.text}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
