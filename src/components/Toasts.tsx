import React from 'react';
import { Undo2, X } from 'lucide-react';
import { useStore } from '../lib/store';

/** Transient toast stack: message + optional Undo, auto-dismisses after 6s. */
export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismissToast = useStore((s) => s.dismissToast);
  if (!toasts.length) return null;
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className="toast fade-in">
          <span className="toast-msg">{t.message}</span>
          {t.undo && (
            <button
              className="toast-undo"
              onClick={() => {
                t.undo?.();
                useStore.getState().dismissToast(t.id);
              }}
            >
              <Undo2 size={11} /> Undo
            </button>
          )}
          <button className="toast-close" onClick={() => dismissToast(t.id)}>
            <X size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}
