import React, { useEffect, useMemo, useRef, useState } from 'react';
import Editor, { useMonaco, type BeforeMount, type Monaco, type OnMount } from '@monaco-editor/react';
import { Loader2 } from 'lucide-react';
import { useStore, type OpenTab } from '../lib/store';

/**
 * Monaco themes are registered from the live CSS palette so the editor canvas
 * always matches the app theme (dark / light / OLED true-black). Only core
 * vars are read — styles.css declares them as plain hex (no color-mix).
 */
const THEME_VARS = ['--bg', '--bg-elev', '--text', '--text-dim', '--text-faint', '--accent', '--border', '--border-strong', '--ok', '--warn', '--err'] as const;

function readThemeVars(): Record<string, string> {
  const s = getComputedStyle(document.documentElement);
  const out: Record<string, string> = {};
  for (const v of THEME_VARS) out[v] = s.getPropertyValue(v).trim();
  return out;
}

function defineAetherTheme(monaco: Monaco, name: string, vars: Record<string, string>): void {
  const c = (v: string, fallback: string) => (vars[v] ? vars[v] : fallback);
  const bg = c('--bg', '#0b0d14');
  const text = c('--text', '#e8eaf2');
  const faint = c('--text-faint', '#7e8596');
  const dim = c('--text-dim', '#9ba1b0');
  const accent = c('--accent', '#6E62E5');
  const border = c('--border', '#232329');
  const noHash = (hex: string) => hex.replace(/^#/, '');
  monaco.editor.defineTheme(name, {
    base: name === 'aether-light' ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: noHash(faint), fontStyle: 'italic' },
      { token: 'delimiter', foreground: noHash(faint) },
      { token: 'string', foreground: noHash(c('--ok', '#7cc08f')) },
      { token: 'number', foreground: noHash(c('--warn', '#e0b84e')) },
      { token: 'keyword', foreground: noHash(accent) },
      { token: 'type', foreground: noHash(dim), fontStyle: 'bold' },
    ],
    colors: {
      'editor.background': bg,
      'editor.foreground': text,
      'editorCursor.foreground': accent,
      'editor.selectionBackground': `${accent}52`,
      'editor.lineHighlightBackground': c('--bg-elev', '#11131c'),
      'editorLineNumber.foreground': faint,
      'editorLineNumber.activeForeground': dim,
      'editorIndentGuide.background1': border,
      'editorIndentGuide.activeBackground1': c('--border-strong', '#34343c'),
      'editorWidget.background': c('--bg-elev', '#11131c'),
      'editorWidget.border': border,
      'editorGutter.background': bg,
      'minimap.background': bg,
      'scrollbarSlider.background': `${border}80`,
      'scrollbarSlider.hoverBackground': border,
    },
  });
}
import { get } from '../lib/api';
import { confirmDialog } from '../lib/dialogs';
import type { ChangeProposal } from '../../shared/types';

export function EditorView({ tab }: { tab: OpenTab }) {
  const fileContents = useStore((s) => s.fileContents);
  const setFileContent = useStore((s) => s.setFileContent);
  const saveFile = useStore((s) => s.saveFile);
  const dirtyFiles = useStore((s) => s.dirtyFiles) as string[];
  const workspaceId = useStore((s) => s.workspaceId);
  const model = useStore((s) => s.models.find((m) => m.id === (s.chatModel || s.selectedModel)));
  const editorRef = useRef<unknown>(null);
  const [explain, setExplain] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const content = tab.path ? fileContents[tab.path] : undefined;
  const themeName = useStore((s) => s.settings?.ui.theme ?? 'dark');
  const monaco = useMonaco();

  // Re-register and switch to the theme derived from the live CSS palette
  // whenever the app theme changes (dark / light / OLED).
  // NOTE: child effects run BEFORE parent effects in React, and App.tsx
  // updates <html data-theme> in its own effect. Without the synchronous
  // dataset write below, this effect would read the PREVIOUS theme's CSS
  // palette — so each toggle baked stale colors into the editor theme and
  // repeated toggles made it visibly drift/confuse.
  useEffect(() => {
    if (!monaco) return;
    document.documentElement.dataset.theme = themeName;
    defineAetherTheme(monaco, `aether-${themeName}`, readThemeVars());
    monaco.editor.setTheme(`aether-${themeName}`);
  }, [monaco, themeName]);

  const lang = useMemo(() => {
    const ext = tab.path?.split('.').pop()?.toLowerCase() ?? '';
    const map: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
      json: 'json', md: 'markdown', css: 'css', html: 'html', py: 'python',
      go: 'go', rs: 'rust', sql: 'sql', yml: 'yaml', yaml: 'yaml', sh: 'shell',
    };
    return map[ext] ?? 'plaintext';
  }, [tab.path]);

  const beforeMount: BeforeMount = (monacoInstance) => {
    defineAetherTheme(monacoInstance, `aether-${themeName}`, readThemeVars());
  };

  const onMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  // Ctrl+S handled globally; expose a save button for dirty files
  const dirty = tab.path ? dirtyFiles.includes(tab.path) : false;
  async function runAiEdit(instruction: string) {
    if (!tab.path || !workspaceId) return;
    setAiBusy(true);
    setExplain(null);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: `File ${tab.path}:\n\n\`\`\`\n${content?.slice(0, 12000)}\n\`\`\`\n\n${instruction}\n\nRespond with the complete modified file content inside a single \`\`\` code block, nothing else.` }],
          model: useStore.getState().chatModel || useStore.getState().selectedModel,
          skillsEnabled: true,
        }),
      });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = '', acc = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const p = JSON.parse(line.slice(5).trim());
          if (p.type === 'delta') acc += p.delta;
          if (p.type === 'done') acc = p.text || acc;
          if (p.type === 'error') acc = `Error: ${p.error}`;
        }
      }
      // Extract code block if present
      const m = acc.match(/```[a-z]*\n([\s\S]*?)```/);
      const newContent = m ? m[1] : acc;
      if (m || (await confirmDialog({ title: 'Apply AI response as file content?', message: 'No code block was found in the response. Apply the raw text as the new file content?', confirmLabel: 'Apply' }))) {
        setFileContent(tab.path!, newContent);
        void saveFile(tab.path!, newContent);
      }
    } finally {
      setAiBusy(false);
    }
  }

  async function explainSelection() {
    const ed = editorRef.current as { getSelection?: () => unknown; getModel?: () => unknown; getValueInRange?: (s: unknown) => string } | null;
    let sel = '';
    try {
      const s = ed?.getSelection?.();
      if (s && ed?.getValueInRange) sel = ed.getValueInRange(s);
    } catch { /* noop */ }
    const text = sel || (content?.slice(0, 4000) ?? '');
    setAiBusy(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: `Explain this code concisely:\n\n\`\`\`\n${text}\n\`\`\`` }],
          model: useStore.getState().chatModel || useStore.getState().selectedModel,
          skillsEnabled: false,
        }),
      });
      const data = await res.json().catch(() => null);
      // non-stream fallback: read SSE quickly
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let acc = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
      }
      const deltas = [...acc.matchAll(/"delta":"((?:[^"\\]|\\.)*)"/g)].map((m2) => JSON.parse(`"${m2[1]}"`));
      const doneMatch = acc.match(/"type":"done","text":((?:[^"\\]|\\.)*)/);
      let out = deltas.join('');
      if (doneMatch) { try { out = JSON.parse(`"${doneMatch[1]}"`).replace(/"\}$/,''); } catch { /* keep acc */ } }
      setExplain(out || 'No explanation returned.');
    } finally {
      setAiBusy(false);
    }
  }

  // Hooks must run unconditionally — the diff-tab early return comes after.
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);

  if (tab.kind === 'diff') return <DiffView tab={tab} />;

  // Full path for the window/tab tooltip; the inline breadcrumb shows the
  // directory only (the tab already shows the file name — no duplication).
  const dirPath = tab.path?.includes('/') ? tab.path.slice(0, tab.path.lastIndexOf('/')) : '';

  const trackSelection = () => {
    const ed = editorRef.current as { getSelection?: () => unknown; getModel?: () => unknown; getValueInRange?: (s: unknown) => string } | null;
    try {
      const s = ed?.getSelection?.();
      setHasSelection(!!s && !!ed?.getValueInRange && !!ed.getValueInRange(s));
    } catch { setHasSelection(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="breadcrumbs">
        {dirPath && <span className="crumb-dir" title={tab.path}>{dirPath}/</span>}
        <div style={{ flex: 1 }} />
        {dirty && <button className="primary" onClick={() => tab.path && content !== undefined && void saveFile(tab.path, content)}>Save</button>}
        <div className="ai-menu-wrap">
          <button
            onClick={() => { setAiMenuOpen((v) => !v); trackSelection(); }}
            title="AI actions — some apply to your current selection"
          >
            AI actions {(hasSelection || aiMenuOpen) && <span className="ai-menu-sel-badge">selection</span>}
          </button>
          {aiMenuOpen && (
            <div className="ai-menu fade-in" onMouseLeave={() => setAiMenuOpen(false)}>
              <button onClick={() => { setAiMenuOpen(false); void explainSelection(); }} disabled={aiBusy}>Explain{hasSelection ? ' selection' : ' file'}</button>
              <button onClick={() => { setAiMenuOpen(false); void runAiEdit('Refactor this code for clarity and performance.'); }} disabled={aiBusy}>AI Refactor</button>
              <button onClick={() => { setAiMenuOpen(false); void runAiEdit('Add clear docstring comments.'); }} disabled={aiBusy}>Add Comments</button>
              <button onClick={() => { setAiMenuOpen(false); void runAiEdit('Find and fix bugs and potential errors.'); }} disabled={aiBusy}>Fix Errors</button>
            </div>
          )}
        </div>
        {aiBusy && <Loader2 size={13} className="spin icon-run" />}
        {model?.vision && <span className="badge">vision</span>}
      </div>
      {explain && (
        <div className="bubble" style={{ margin: '8px 12px', maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
          {explain}
          <div><button style={{ marginTop: 6 }} onClick={() => setExplain(null)}>Dismiss</button></div>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        <Editor
          height="100%"
          language={lang}
          theme={`aether-${themeName}`}
          beforeMount={beforeMount}
          value={content ?? ''}
          onMount={onMount}
          onChange={(v) => tab.path && setFileContent(tab.path, v ?? '')}
          options={{
            fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono').trim() || "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
            fontSize: useStore.getState().settings?.ui.fontSize ?? 13,
            lineHeight: 1.45,
            fontLigatures: true,
            smoothScrolling: true,
            cursorBlinking: "phase",
            cursorSmoothCaretAnimation: "on",
            minimap: { enabled: true },
            automaticLayout: true,
            scrollBeyondLastLine: false,
            lineNumbersMinChars: 3,
            padding: { top: 10, bottom: 10 },
            fixedOverflowWidgets: true,
          }}
        />
      </div>
    </div>
  );
}

export function DiffView({ tab }: { tab: OpenTab }) {
  const proposals = useStore((s) => s.proposals);
  const acceptProposal = useStore((s) => s.acceptProposal);
  const rejectProposal = useStore((s) => s.rejectProposal);
  const proposal = proposals.find((p) => p.id === tab.path?.replace('proposal:', '')) ?? proposals[0];

  if (!proposal) return <div className="empty-state">No pending proposals.</div>;
  return (
    <div className="panel-body diff-view">
      {proposal.files.map((f) => (
        <div key={f.path} className="diff-file">
          <div className="diff-file-head">
            <strong>{f.path}</strong>
            <span style={{ color: 'var(--ok)' }}>+{f.additions}</span>
            <span style={{ color: 'var(--err)' }}>−{f.deletions}</span>
          </div>
          {f.hunks.map((h, hi) => (
            <div key={hi}>
              {h.lines.map((l, li) => (
                <div key={li} className={`diff-line ${l.type}`}>
                  <span className="ln">{l.old > 0 ? l.old : ''}{l.new > 0 ? ` / ${l.new}` : ''}</span>
                  <span className="sign">{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '}</span>
                  <span style={{ whiteSpace: 'pre-wrap' }}>{l.text}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
