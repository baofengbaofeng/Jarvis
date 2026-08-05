import { DEFAULT_SHORTCUTS, type ShortcutBindings } from '@jarvis/core';

// C5 (M8 Task 7): app-internal shortcuts, persisted under the `shortcuts`
// settings key. Merged over DEFAULT_SHORTCUTS so a partial/corrupt value still
// yields a complete binding map (every action always has a combo).
export function createShortcutsIpc(getSetting: (k: string) => unknown, setSetting: (k: string, v: unknown) => void) {
  const get = (): ShortcutBindings => ({ ...DEFAULT_SHORTCUTS, ...(getSetting('shortcuts') as Partial<ShortcutBindings> | undefined) });
  const set = (_e: unknown, bindings: ShortcutBindings) => { setSetting('shortcuts', bindings); return get(); };
  return { get, set };
}
