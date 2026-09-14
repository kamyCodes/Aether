import React, { useEffect, useMemo, useState } from 'react';
import { GitBranch, RefreshCw, X, FileDiff as FileDiffIcon } from 'lucide-react';
import { diffLines } from 'diff';
import { useStore, type ReviewFile } from '../lib/store';
import { get } from '../lib/api';
import type { DiffHunk } from '../../shared/types';

/**
 * "Review pending changes" view: real git working-tree diffs vs HEAD for the
 * whole workspace, merged with unsaved editor buffers. Dirty buffers get a
 * client-side diff of saved-on-disk vs the in-memory buffer, so pending work
 * is reviewable even when the folder isn't a git repo.
 */

const STATUS_LABEL: Record<string, string> = { added: 'new', modified: 'mod', deleted: 'del' };

export function ReviewPanel() {
  const workspaceId = useStore((s) => s.workspaceId);
  const fileContents = useStore((s) => s.fileContents);
  const dirtyFiles = useStore((s) => s.dirtyFiles);
  const dirty = (Array.isArray(dirtyFiles) ? dirtyFiles : [...dirtyFiles]) as string[];
  const openFile = useStore((s) => s.openFile);
  const loadReview = useStore((s) => s.loadReview);

  const [loading, setLoading] = useState(true);
  const [branch, setBranch] = useState('');
  const [gitFiles, setGitFiles] = useState<ReviewFile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [bufferHunks, setBufferHunks] = useState<Record<string, DiffHunk[]>>({});

  const refresh = async () => {
    setLoading(true);
    const data = await loadReview();
    setBranch(data.branch);
    setGitFiles(data.files);
    setLoading(false);
    setSelected((cur) =>
      cur && data.files.some((f) => f.path === cur) ? cur : (data.files[0]?.path ?? null),
    );
  };

  useEffect(() => {
    void refresh(); /* eslint-disable-next-line */
  }, [workspaceId]);

  // Unsaved buffers not already covered by the git list: diff buffer vs the
  // on-disk saved content (fetched per file, cached until refresh).
  useEffect(() => {
    let cancelled = false;
    const inGit = new Set(gitFiles.map((f) => f.path));
    const todo = dirty.filter((p) => !inGit.has(p));
    void (async () => {
      const out: Record<string, DiffHunk[]> = {};
      await Promise.all(
        todo.map(async (p) => {
          const buffer = fileContents[p];
          if (buffer === undefined) return;
          let saved = '';
          try {
            if (workspaceId) {
              saved = (
                await get<{ content: string }>(
                  `/workspaces/${workspaceId}/file?path=${encodeURIComponent(p)}`,
                )
              ).content;
            }
          } catch {
            saved = ''; /* deleted from disk: whole buffer is an addition */
          }
          out[p] = buildBufferDiff(p, saved, buffer);
        }),
      );
      if (!cancelled) setBufferHunks(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [dirty, gitFiles, fileContents, workspaceId]);

  const dirtyEntries = useMemo(() => {
    const inGit = new Set(gitFiles.map((f) => f.path));
    return dirty.filter((p) => !inGit.has(p));
  }, [dirty, gitFiles]);

  const totalAdd = gitFiles.reduce((a, f) => a + f.additions, 0);
  const totalDel = gitFiles.reduce((a, f) => a + f.deletions, 0);
  const isEmpty = !loading && gitFiles.length === 0 && dirtyEntries.length === 0;

  const selectedGit = gitFiles.find((f) => f.path === selected);
  const selectedDirtyPath = dirtyEntries.find((p) => p === selected);

  return (
    <div className="panel-body review-panel">
      <div className="review-list">
        <div className="review-head">
          <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <GitBranch size={13} /> {branch || 'No git repo'}
          </strong>
          <span className="review-stats">
            {gitFiles.length > 0 && (
              <>
                <span style={{ color: 'var(--ok)' }}>+{totalAdd}</span>{' '}
                <span style={{ color: 'var(--err)' }}>−{totalDel}</span>
                {' · '}
              </>
            )}
            {gitFiles.length} changed
            {dirtyEntries.length ? ` · ${dirtyEntries.length} unsaved` : ''}
          </span>
          <div style={{ flex: 1 }} />
          <button title="Refresh" onClick={() => void refresh()}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
          </button>
        </div>

        {isEmpty ? (
          <div className="empty-state">
            Nothing pending — working tree clean, no unsaved buffers.
          </div>
        ) : (
          <div className="review-files">
            {gitFiles.map((f) => (
              <button
                key={f.path}
                className={`review-file ${selected === f.path ? 'active' : ''}`}
                onClick={() => setSelected(f.path)}
                title={`${f.status} · +${f.additions} −${f.deletions}`}
              >
                <span className={`badge ${f.status === 'added' ? 'on' : ''}`}>
                  {STATUS_LABEL[f.status] ?? f.status}
                </span>
                <span className="review-file-path">{f.path}</span>
                <span className="review-file-stats">
                  <span style={{ color: 'var(--ok)' }}>+{f.additions}</span>{' '}
                  <span style={{ color: 'var(--err)' }}>−{f.deletions}</span>
                </span>
              </button>
            ))}
            {dirtyEntries.map((p) => (
              <button
                key={p}
                className={`review-file ${selected === p ? 'active' : ''}`}
                onClick={() => setSelected(p)}
                title="Unsaved editor buffer"
              >
                <span className="badge" style={{ color: 'var(--warn)' }}>
                  buf
                </span>
                <span className="review-file-path">{p}</span>
                <span className="dirty-dot" title="Unsaved" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="review-diff">
        {selectedGit && (
          <DiffBody
            path={selectedGit.path}
            stats={
              <>
                <span style={{ color: 'var(--ok)' }}>+{selectedGit.additions}</span>
                <span style={{ color: 'var(--err)' }}>−{selectedGit.deletions}</span>
              </>
            }
            hunks={selectedGit.hunks}
            onOpen={() => void openFile(selectedGit.path)}
          />
        )}
        {selectedDirtyPath &&
          (bufferHunks[selectedDirtyPath]?.length ? (
            <DiffBody
              path={selectedDirtyPath}
              stats={
                <span className="badge" style={{ color: 'var(--warn)' }}>
                  unsaved buffer
                </span>
              }
              hunks={bufferHunks[selectedDirtyPath]}
              onOpen={() => void openFile(selectedDirtyPath)}
            />
          ) : (
            <div className="empty-state">Buffer matches the saved file — nothing to show.</div>
          ))}
        {!selectedGit && !selectedDirtyPath && !isEmpty && !loading && (
          <div className="empty-state">Select a file to see its diff.</div>
        )}
      </div>
    </div>
  );
}

/** Unified hunks for saved-on-disk vs in-memory buffer. */
function buildBufferDiff(path: string, saved: string, buffer: string): DiffHunk[] {
  if (saved === buffer) return [];
  const hunks: DiffHunk[] = [{ header: `@@ ${path} (buffer) @@`, lines: [] }];
  let o = 1;
  let n = 1;
  for (const part of diffLines(saved, buffer)) {
    const lines = part.value.replace(/\n$/, '').split('\n');
    if (part.added)
      for (const l of lines) hunks[0].lines.push({ type: 'add', old: -1, new: n++, text: l });
    else if (part.removed)
      for (const l of lines) hunks[0].lines.push({ type: 'del', old: o++, new: -1, text: l });
    else for (const l of lines) hunks[0].lines.push({ type: 'ctx', old: o++, new: n++, text: l });
  }
  return hunks;
}

/** Shared diff renderer for git files and dirty buffers. */
function DiffBody({
  path,
  stats,
  hunks,
  onOpen,
}: {
  path: string;
  stats: React.ReactNode;
  hunks: DiffHunk[];
  onOpen: () => void;
}) {
  return (
    <>
      <div className="diff-file-head">
        <FileDiffIcon size={13} className="icon-dim" />
        <strong>{path}</strong>
        {stats}
        <div style={{ flex: 1 }} />
        <button onClick={onOpen} title="Open in editor">
          Open
        </button>
        <button onClick={() => useStore.setState({ activeTabId: null })} title="Close">
          <X size={13} />
        </button>
      </div>
      <div className="diff-view">
        {hunks.map((h, hi) => (
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
    </>
  );
}
