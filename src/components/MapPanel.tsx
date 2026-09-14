import React, { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { get } from '../lib/api';

interface MapResp {
  map: string;
  deps: { from: string; to: string }[];
}

export function MapPanel() {
  const workspaceId = useStore((s) => s.workspaceId);
  const openFile = useStore((s) => s.openFile);
  const [resp, setResp] = useState<MapResp | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    void get<MapResp>(`/workspaces/${workspaceId}/map`)
      .then(setResp)
      .catch(() => {});
  }, [workspaceId]);

  return (
    <div className="panel-body" style={{ display: 'flex' }}>
      <div style={{ flex: 1, padding: 12, borderRight: '1px solid var(--border)' }}>
        <div className="palette-section">Architecture / codebase map</div>
        <pre
          style={{
            fontSize: 12,
            whiteSpace: 'pre-wrap',
            color: 'var(--text-dim)',
            lineHeight: 1.7,
          }}
        >
          {resp?.map ?? 'Index the project first (Ctrl+K → Re-index Project).'}
        </pre>
      </div>
      <div style={{ flex: 1, padding: 12, overflow: 'auto' }}>
        <div className="palette-section">Internal dependency edges</div>
        {resp?.deps.map((d, i) => (
          <div key={i} className="result-item">
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
              {d.from} → {d.to}
            </span>
          </div>
        ))}
        {resp && resp.deps.length === 0 && (
          <div className="empty-state">No internal imports found.</div>
        )}
      </div>
    </div>
  );
}
