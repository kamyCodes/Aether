import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileIcon } from '../lib/fileIcons';
import { promptDialog } from '../lib/dialogs';
import { openFileWithNativePicker } from './Dialogs';
import { useStore } from '../lib/store';
import { post } from '../lib/api';
import type { FileNode } from '../../shared/types';

interface Cmd { id: string; label: string; hint?: string; run: () => void | Promise<void> }

export function CommandPalette({ onClose, onOpenSettings }: { onClose: () => void; onOpenSettings: () => void }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const store = useStore.getState();

  useEffect(() => { inputRef.current?.focus(); }, []);

  const files = useMemo(() => flattenFiles(store.tree), [store.tree]);

  const commands: Cmd[] = useMemo(() => [
    { id: 'new-chat', label: 'New Chat', hint: 'chat', run: () => store.newChat() },
    { id: 'agent-task', label: 'Run Agent Task…', hint: 'agent', run: async () => {
      const prompt = await promptDialog({ title: 'Run agent task', placeholder: 'Describe the task…', confirmLabel: 'Run' });
      if (prompt) void store.startTask(prompt, 'agent');
    } },
    { id: 'plan-task', label: 'Plan (no modifications)…', hint: 'agent', run: async () => {
      const prompt = await promptDialog({ title: 'Plan without modifying', placeholder: 'What should the agent plan?', confirmLabel: 'Plan' });
      if (prompt) void store.startTask(prompt, 'plan');
    } },
    { id: 'search', label: 'Search Project', hint: 'view', run: () => store.openTab({ kind: 'search', title: 'Search' }) },
    { id: 'git', label: 'Open Git Panel', hint: 'view', run: () => store.openTab({ kind: 'git', title: 'Git' }) },
    { id: 'skills', label: 'Skills Manager', hint: 'view', run: () => store.openTab({ kind: 'skills', title: 'Skills' }) },
    { id: 'map', label: 'Codebase Map', hint: 'view', run: () => store.openTab({ kind: 'map', title: 'Codebase Map' }) },
    { id: 'checkpoint', label: 'Create Checkpoint', hint: 'agent', run: () => {
      void post(`/workspaces/${store.workspaceId}/checkpoints`, { label: 'Manual checkpoint' });
    } },
    { id: 'index', label: 'Re-index Project', hint: 'project', run: () => {
      void post(`/workspaces/${store.workspaceId}/index`, { incremental: false });
    } },
    { id: 'settings', label: 'Open Settings', hint: 'ui', run: onOpenSettings },
    { id: 'theme', label: 'Toggle Theme (dark / light / OLED)', hint: 'ui', run: () => {
      const s = store.settings;
      const next = { dark: 'light', light: 'oled', oled: 'dark' } as const;
      if (s) void store.saveSettings({ ...s, ui: { ...s.ui, theme: next[s.ui.theme] ?? 'dark' } });
    } },
    { id: 'open-file', label: 'Open File (system dialog)…', hint: 'file', run: () => openFileWithNativePicker() },
    { id: 'add-ws', label: 'Add Workspace Folder…', hint: 'project', run: async () => {
      const root = await promptDialog({ title: 'Add workspace folder', placeholder: 'Absolute folder path…', folderPicker: true, confirmLabel: 'Add' });
      if (root) void store.addWorkspace(root);
    } },
  ], [store, onOpenSettings]);

  const q = query.replace(/^>?\s*/, '');
  const isFileMode = query.startsWith('>');
  const filteredCmds = isFileMode ? [] : commands.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  const filteredFiles = isFileMode ? files.filter((f) => f.toLowerCase().includes(q.toLowerCase())).slice(0, 12) : [];
  const results = [...filteredCmds.map((c) => ({ kind: 'cmd' as const, ...c })), ...filteredFiles.map((f) => ({ kind: 'file' as const, label: f, run: () => void store.openFile(f) }))];
  const sel = results[Math.min(selected, results.length - 1)];

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="modal-input"
          style={{ width: 'calc(100% - 24px)' }}
          placeholder="Type a command, or > to search files…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, results.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(0, s - 1)); }
            if (e.key === 'Enter' && sel) { sel.run(); onClose(); }
            if (e.key === 'Escape') onClose();
          }}
        />
        <div className="modal-results">
          {!isFileMode && filteredCmds.length > 0 && <div className="palette-section">Commands</div>}
          {filteredCmds.map((c) => (
            <div key={c.id} className={`result-item ${sel?.kind === 'cmd' && sel.id === c.id ? 'selected' : ''}`} onClick={() => { c.run(); onClose(); }}>
              {c.label}<span className="hint">{c.hint}</span>
            </div>
          ))}
          {isFileMode && filteredFiles.length > 0 && <div className="palette-section">Files</div>}
          {filteredFiles.map((f) => (
            <div key={f} className="result-item" onClick={() => { void store.openFile(f); onClose(); }}>
              <span className="file-ico"><FileIcon name={f.split('/').pop() ?? f} size={14} /></span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{f}</span>
            </div>
          ))}
          {results.length === 0 && <div className="result-item" style={{ color: 'var(--text-faint)' }}>No matches</div>}
        </div>
      </div>
    </div>
  );
}

function flattenFiles(node: FileNode | null): string[] {
  const out: string[] = [];
  const walk = (n: FileNode) => {
    if (n.type === 'file') out.push(n.path);
    n.children?.forEach(walk);
  };
  if (node) walk(node);
  return out;
}
