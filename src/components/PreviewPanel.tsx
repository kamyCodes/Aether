import React, { useEffect, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { useStore } from '../lib/store';
import { post } from '../lib/api';
import { GlassSegmentedControl } from './glass';

const SIZES = { desktop: '100%', tablet: '768px', mobile: '390px' } as const;

export function PreviewPanel() {
  const workspaceId = useStore((s) => s.workspaceId);
  const [url, setUrl] = useState('');
  const [device, setDevice] = useState<keyof typeof SIZES>('desktop');
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (!workspaceId) return;
    try {
      const r = await post<{ url: string }>('/preview/start', { workspaceId });
      setUrl(r.url);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="preview-toolbar">
        <button className="primary" onClick={() => void start()}>
          Start Preview
        </button>
        {/* Liquid Glass: Radix ToggleGroup + layoutId indicator */}
        <GlassSegmentedControl
          layoutId="preview-device"
          className="mode-toggle"
          ariaLabel="Preview device size"
          value={device}
          onValueChange={(v) => setDevice(v as keyof typeof SIZES)}
          options={(Object.keys(SIZES) as (keyof typeof SIZES)[]).map((d) => ({
            value: d,
            label: d,
          }))}
        />
        <input
          style={{ flex: 1 }}
          placeholder="Paste a URL to preview"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setUrl(input);
          }}
        />
        {url && (
          <button onClick={() => setUrl(url)}>
            <RotateCw size={12} /> Reload
          </button>
        )}
      </div>
      {error && <div style={{ padding: 8, color: 'var(--err)', fontSize: 12 }}>{error}</div>}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          justifyContent: 'center',
          background: 'var(--bg)',
          overflow: 'auto',
        }}
      >
        {url ? (
          <iframe
            key={url + device}
            className="preview-frame"
            src={url}
            style={{ width: SIZES[device] }}
            title="preview"
          />
        ) : (
          <div className="empty-state">
            <div>Live preview serves the workspace over HTTP with reload-on-change.</div>
            <div style={{ fontSize: 11 }}>
              Best for static sites / built output. Start a dev server in the terminal for HMR apps.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
