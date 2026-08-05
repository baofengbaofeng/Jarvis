import { useEffect, useRef } from 'react';
import { lookup, normalizeCombo, type ShortcutAction } from '@jarvis/core/renderer';

// C5 (M8 Task 7): installs a single window keydown listener that resolves the
// persisted bindings from main (shortcuts.get) and dispatches the matching
// handler. Uses core normalizeCombo so the hook and the settings view agree on
// combo strings. The INPUT+Esc guard keeps Esc inside an input field with the
// component (cancel/send is handled locally), avoiding double-handling.
export function useShortcuts(handlers: Partial<Record<ShortcutAction, () => void>>) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === 'Escape') return;
      void (async () => {
        const bindings = (await window.jarvis.invoke('shortcuts.get')) as Record<ShortcutAction, string>;
        const action = lookup(bindings, normalizeCombo(e));
        if (action && ref.current[action]) { e.preventDefault(); ref.current[action]!(); }
      })();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
