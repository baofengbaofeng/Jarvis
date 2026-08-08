import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

const WIDTH_KEY = 'jarvis.sidebar.width';
const COLLAPSED_KEY = 'jarvis.sidebar.collapsed';
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 420;
/** Fully hide the menu column; traffic lights + toggle stay in window chrome. */
export const SIDEBAR_COLLAPSED = 0;
export const SIDEBAR_DEFAULT = 264;

function readWidth(): number {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(n) && n >= SIDEBAR_MIN && n <= SIDEBAR_MAX) return n;
  } catch { /* ignore */ }
  return SIDEBAR_DEFAULT;
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function useSidebarChrome() {
  const [width, setWidth] = useState(readWidth);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    try { localStorage.setItem(WIDTH_KEY, String(width)); } catch { /* ignore */ }
  }, [width]);

  useEffect(() => {
    try { localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [collapsed]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => !c);
  }, []);

  const onResizePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (collapsed) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: width };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [collapsed, width]);

  const onResizePointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, drag.startWidth + (e.clientX - drag.startX)));
    setWidth(next);
  }, []);

  const onResizePointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }, []);

  const effectiveWidth = collapsed ? SIDEBAR_COLLAPSED : width;

  return {
    width,
    collapsed,
    effectiveWidth,
    toggleCollapsed,
    onResizePointerDown,
    onResizePointerMove,
    onResizePointerUp,
  };
}
