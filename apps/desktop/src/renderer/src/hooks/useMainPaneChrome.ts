import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

const WIDTH_KEY = 'jarvis.main.width';
export const MAIN_MIN = 480;
export const MAIN_MAX = 1200;
export const MAIN_DEFAULT = 800;

function readWidth(): number {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(n) && n >= MAIN_MIN && n <= MAIN_MAX) return n;
  } catch { /* ignore */ }
  return MAIN_DEFAULT;
}

/** Main content column width (default 800px); right edge is a resize handle for a future right pane. */
export function useMainPaneChrome() {
  const [width, setWidth] = useState(readWidth);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    try { localStorage.setItem(WIDTH_KEY, String(width)); } catch { /* ignore */ }
  }, [width]);

  const onResizePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: width };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [width]);

  const onResizePointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const next = Math.min(MAIN_MAX, Math.max(MAIN_MIN, drag.startWidth + (e.clientX - drag.startX)));
    setWidth(next);
  }, []);

  const onResizePointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }, []);

  return {
    width,
    onResizePointerDown,
    onResizePointerMove,
    onResizePointerUp,
  };
}
