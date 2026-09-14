import React, { useState } from 'react';
import { FileIcon } from '../lib/fileIcons';
import { useStore } from '../lib/store';
import { post } from '../lib/api';

interface IndexedSymbol { name: string; kind: string; path: string; line: number }

interface SearchResp { files: { path: string; score: number }[]; symbols: IndexedSymbol[] }

export function SearchPanel() {
  const workspaceId = useStore((s) => s.workspaceId);
  const openFile = useStore((s) => s.openFile);
  const [query, setQuery] = useState('');
  const [resp, setResp] = useState<SearchResp | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!workspaceId || !query.trim()) return;
    setBusy(true);
    try { setResp(await post<SearchResp>(`/workspaces/${workspaceId}/search`, { query })); }
    finally { setBusy(false); }
  }

  return (
    <div className="panel-body" style={{ padding: 10 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <input
          style={{ flex: 1 }}
          autoFocus
          placeholder="Search files and symbols…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void run()}
        />
        <button className="primary" onClick={() => void run()} disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
      </div>
      {resp && (
        <div>
          {resp.symbols.length > 0 && <div className="palette-section">Symbols</div>}
          {resp.symbols.map((s, i) => (
            <div key={i} className="result-item" onClick={() => void openFile(s.path)}>
              <span className="badge">{s.kind}</span> {s.name} <span className="hint">{s.path}:{s.line}</span>
            </div>
          ))}
          {resp.files.length > 0 && <div className="palette-section">Files</div>}
          {resp.files.map((f) => (
            <div key={f.path} className="result-item" onClick={() => void openFile(f.path)}>
              <span className="file-ico"><FileIcon name={f.path.split('/').pop() ?? f.path} size={14} /></span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.path}</span>
              <span className="hint">score {f.score.toFixed(1)}</span>
            </div>
          ))}
          {resp.files.length === 0 && resp.symbols.length === 0 && <div className="empty-state">No results (index may still be building).</div>}
        </div>
      )}
    </div>
  );
}
