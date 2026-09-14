import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  separator?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}

/**
 * Right-click context menu rendered in a portal so it escapes the sidebar's
 * overflow. Clamps to the viewport, closes on outside click / Escape / scroll.
 */
export function ContextMenu({ x, y, items, onClose }: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    // Clamp into the viewport once measured.
    const el = ref.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setPos({
        x: Math.min(x, window.innerWidth - r.width - 6),
        y: Math.min(y, window.innerHeight - r.height - 6),
      });
    }
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('contextmenu', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onClose, { passive: true });
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onClose);
    };
  }, [x, y, onClose]);

  return createPortal(
    <div ref={ref} className="context-menu fade-in" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) =>
        it.separator ? (
          <div key={`sep-${i}`} className="context-menu-sep" />
        ) : (
          <button
            key={it.label}
            className={`context-menu-item ${it.danger ? 'danger' : ''}`}
            disabled={it.disabled}
            onClick={() => { onClose(); it.onSelect?.(); }}
          >
            {it.icon && <span className="context-menu-ico">{it.icon}</span>}
            {it.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
