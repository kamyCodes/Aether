import React, { useCallback, useRef } from 'react';

/**
 * Panel divider. The dragged panel's CURRENT size is read from the DOM on
 * mousedown instead of assuming a constant, so a drag from any state (and
 * after any number of window resizes) starts from where the panel actually
 * is — the old hardcoded 240px start made every drag jump and could push
 * the row past the window edge. Deltas are clamped by the parent's own
 * min/max on the size state; this component only reports the delta.
 */
export function Resizer({
  vertical,
  horizontal,
  reverse,
  onResize,
}: {
  vertical?: boolean;
  horizontal?: boolean;
  reverse?: boolean;
  onResize: (size: number) => void;
}) {
  void vertical;
  const dragging = useRef(false);
  const last = useRef(0);
  const onDown = useCallback(
    (e: React.MouseEvent) => {
      dragging.current = true;
      last.current = e.clientX;
      // Real current panel edge: the resizer sits adjacent to the panel it
      // controls, so its own position IS the panel's current edge.
      const el = e.currentTarget as HTMLElement;
      const rect = el.getBoundingClientRect();
      const origin = reverse ? rect.x : rect.x + rect.width;
      last.current = origin;
      const move = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const cur = ev.clientX;
        const delta = (cur - last.current) * (reverse ? -1 : 1);
        if (delta === 0) return;
        last.current = cur;
        onResize(delta); // parent accumulates: (s) => setWidth(clamp(s + delta))
      };
      const up = () => {
        dragging.current = false;
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        document.body.style.cursor = '';
      };
      document.body.style.cursor = 'col-resize';
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    [reverse, onResize],
  );

  return <div className={`resizer ${vertical ? 'vertical' : 'horizontal'}`} onMouseDown={onDown} />;
}
