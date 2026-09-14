import React, { useEffect, useRef, useState } from 'react';
import { FolderOpen, X } from 'lucide-react';
import { useDialogs, alertDialog } from '../lib/dialogs';
import { useStore } from '../lib/store';

async function pickNative(
  startDir: string | undefined,
  mode: 'folder' | 'file',
): Promise<{ dir: string | null; file: string | null }> {
  // Tag this window's title with a one-time marker so the backend can find
  // our window handle (EnumWindows) and own the native dialog to it — this
  // keeps the picker on top of Aether even if another app took focus.
  const marker = `AETHER-PICKER-${Math.random().toString(36).slice(2, 10)}`;
  const prevTitle = document.title;
  document.title = `${prevTitle} ${marker}`;
  try {
    const r = await fetch('/api/pick-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startDir,
        marker,
        mode,
        workspaceId: useStore.getState().workspaceId,
      }),
    });
    const data = await r.json();
    return { dir: data.dir ?? null, file: data.file ?? null };
  } catch {
    return { dir: null, file: null };
  } finally {
    document.title = prevTitle;
  }
}

export async function openFileWithNativePicker(): Promise<void> {
  const wsId = useStore.getState().workspaceId;
  if (!wsId) {
    await alertDialog(
      'No workspace open',
      'Open a workspace folder first, then pick a file inside it.',
    );
    return;
  }
  const wsRoot = useStore.getState().workspaces.find((w) => w.id === wsId)?.root;
  const { file } = await pickNative(wsRoot, 'file');
  if (file) void useStore.getState().openFile(file);
}

export function Dialogs() {
  const prompt = useDialogs((s) => s.prompt);
  const confirm = useDialogs((s) => s.confirm);
  const alertMsg = useDialogs((s) => s.alertMsg);
  const closePrompt = useDialogs((s) => s.closePrompt);
  const closeConfirm = useDialogs((s) => s.closeConfirm);
  const closeAlert = useDialogs((s) => s.closeAlert);
  const [value, setValue] = useState('');
  const [picking, setPicking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (prompt) {
      setValue(prompt.opts.initialValue ?? '');
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [prompt]);

  const showOverlay = prompt || confirm || alertMsg;

  return (
    <>
      {prompt && (
        <div className="modal-overlay" onMouseDown={() => closePrompt(null)}>
          <div className="modal" style={{ width: 460 }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="panel-header">{prompt.opts.title}</div>
            <div className="settings-form" style={{ padding: '16px 18px', gap: 12 }}>
              {prompt.opts.message && (
                <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{prompt.opts.message}</div>
              )}
              <input
                ref={inputRef}
                value={value}
                placeholder={prompt.opts.placeholder}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') closePrompt(value.trim() || null);
                  if (e.key === 'Escape') closePrompt(null);
                }}
              />
              {prompt.opts.folderPicker && (
                <div className="folder-picker-row">
                  <button
                    disabled={picking}
                    onClick={async () => {
                      setPicking(true);
                      const { dir } = await pickNative(value || undefined, 'folder');
                      setPicking(false);
                      if (dir) setValue(dir);
                      if (!dir) inputRef.current?.focus();
                    }}
                    title="Choose a folder with the system picker"
                  >
                    <FolderOpen size={13} /> {picking ? 'Waiting for picker…' : 'Browse…'}
                  </button>
                  {picking && (
                    <span className="picker-status">
                      Opening system dialog — pick a folder or cancel to return here…
                    </span>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => closePrompt(null)}>
                  {prompt.opts.cancelLabel ?? 'Cancel'}
                </button>
                <button className="primary" onClick={() => closePrompt(value.trim() || null)}>
                  {prompt.opts.confirmLabel ?? 'OK'}
                </button>
              </div>
            </div>
            <button className="modal-close" onClick={() => closePrompt(null)}>
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {confirm && (
        <div className="modal-overlay" onMouseDown={() => closeConfirm(false)}>
          <div className="modal" style={{ width: 420 }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="panel-header">{confirm.opts.title}</div>
            <div className="settings-form" style={{ padding: '16px 18px', gap: 12 }}>
              {confirm.opts.message && (
                <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>{confirm.opts.message}</div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => closeConfirm(false)}>
                  {confirm.opts.cancelLabel ?? 'Cancel'}
                </button>
                <button
                  className={confirm.opts.danger ? 'primary' : 'primary'}
                  style={
                    confirm.opts.danger
                      ? { background: 'var(--err)', borderColor: 'transparent' }
                      : undefined
                  }
                  onClick={() => closeConfirm(true)}
                >
                  {confirm.opts.confirmLabel ?? 'Confirm'}
                </button>
              </div>
            </div>
            <button className="modal-close" onClick={() => closeConfirm(false)}>
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {alertMsg && (
        <div className="modal-overlay" onMouseDown={closeAlert}>
          <div className="modal" style={{ width: 400 }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="panel-header">{alertMsg.title}</div>
            <div className="settings-form" style={{ padding: '16px 18px', gap: 12 }}>
              {alertMsg.message && (
                <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>{alertMsg.message}</div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="primary" onClick={closeAlert}>
                  OK
                </button>
              </div>
            </div>
            <button className="modal-close" onClick={closeAlert}>
              <X size={13} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
