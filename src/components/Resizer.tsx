import React, { useCallback, useRef } from 'react';

export function Resizer({
  vertical,
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
  const startSize = useRef(0);

  const onDown = useCallback(
    (e: React.MouseEvent) => {
      dragging.current = true;
      last.current = e.clientX;
      startSize.current = 240;
      const move = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const cur = ev.clientX;
        const delta = (cur - last.current) * (reverse ? -1 : 1);
        onResize(Math.max(160, startSize.current + delta));
      };
      const up = () => {
        dragging.current = false;
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    [vertical, reverse, onResize],
  );

  return <div className={`resizer ${vertical ? 'vertical' : 'horizontal'}`} onMouseDown={onDown} />;
}
