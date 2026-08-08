import { useEffect, useState } from 'react';
import { IpcChannel, IpcEvent } from '@jarvis/protocol';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|darwin/i.test(navigator.platform || navigator.userAgent);
/** Windowed default: 14 + 52 + 14 — see macTitlebar titleInsetFor(false). */
const DEFAULT_TITLE_INSET = IS_MAC ? 80 : 12;

export type WindowChrome = {
  fullscreen: boolean;
  /** Titlebar padding-left for collapse (windowed ≠ fullscreen). */
  titleInset: number;
};

function parseChrome(payload: unknown): WindowChrome | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  // titleInset preferred; accept older iconCol / collapseLeft keys.
  const titleInset = Number(p.titleInset ?? p.iconCol ?? p.collapseLeft);
  if (!Number.isFinite(titleInset)) return null;
  return {
    fullscreen: p.fullscreen === true,
    titleInset,
  };
}

export function useWindowChrome(): WindowChrome {
  const [chrome, setChrome] = useState<WindowChrome>({
    fullscreen: false,
    titleInset: DEFAULT_TITLE_INSET,
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.jarvis) return;

    let cancelled = false;
    const apply = (payload: unknown) => {
      const next = parseChrome(payload);
      if (!cancelled && next) setChrome(next);
    };

    void window.jarvis.invoke(IpcChannel.windowGetChrome).then(apply).catch(() => {});

    const unsub = window.jarvis.onDidReceive?.(IpcEvent.windowChrome, apply);
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  return chrome;
}
