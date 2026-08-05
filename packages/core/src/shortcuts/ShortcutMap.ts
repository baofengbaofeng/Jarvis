export type ShortcutAction = 'chat.send' | 'chat.new' | 'settings.open' | 'task.cancel' | 'focus.input';
export type ShortcutBindings = Record<ShortcutAction, string>;

export const DEFAULT_SHORTCUTS: ShortcutBindings = {
  'chat.send': 'Cmd+Enter',
  'chat.new': 'Cmd+K',
  'settings.open': 'Cmd+,',
  'task.cancel': 'Esc',
  'focus.input': 'Cmd+L',
};

// Normalizes a KeyboardEvent-like into a canonical combo string ("Cmd+K").
// metaKey → Cmd, ctrlKey → Ctrl, altKey → Alt, shiftKey → Shift (in that
// order); ' ' → Space; single-char keys are uppercased; named keys pass through.
export function normalizeCombo(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean }): string {
  const mods: string[] = [];
  if (e.metaKey) mods.push('Cmd');
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return mods.length ? `${mods.join('+')}+${key}` : key;
}

// Common non-printing key names, mapped to the canonical form KeyboardEvent.key
// reports so a free-text binding ("enter", "esc") round-trips to the same combo
// string the runtime lookup uses.
const NAMED_KEYS: Record<string, string> = {
  enter: 'Enter',
  esc: 'Esc',
  escape: 'Esc',
  space: 'Space',
  tab: 'Tab',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  backspace: 'Backspace',
  delete: 'Delete',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  insert: 'Insert',
};

// Parse a free-text binding ("cmd + enter", "Ctrl+Shift+P") into the same
// canonical combo form normalizeCombo produces. Unknown parts are kept verbatim.
export function parseBinding(text: string): string {
  const parts = text
    .trim()
    .split('+')
    .map(p => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return '';
  const mods: string[] = [];
  const keys: string[] = [];
  for (const part of parts) {
    const norm = part.toLowerCase();
    if (norm === 'cmd' || norm === 'command' || norm === 'meta') mods.push('Cmd');
    else if (norm === 'ctrl' || norm === 'control') mods.push('Ctrl');
    else if (norm === 'alt' || norm === 'option') mods.push('Alt');
    else if (norm === 'shift') mods.push('Shift');
    else keys.push(part);
  }
  // Keep the same mod order as normalizeCombo (Cmd, Ctrl, Alt, Shift) so a
  // parsed binding round-trips to the same string the runtime lookups on.
  const order = ['Cmd', 'Ctrl', 'Alt', 'Shift'];
  const modsStr = order.filter(m => mods.includes(m)).join('+');
  const key =
    keys.length === 1
      ? NAMED_KEYS[keys[0].toLowerCase()] ?? (keys[0] === ' ' ? 'Space' : keys[0].length === 1 ? keys[0].toUpperCase() : keys[0])
      : keys.join('+');
  return modsStr ? `${modsStr}+${key}` : key;
}

export function lookup(bindings: ShortcutBindings, combo: string): ShortcutAction | null {
  const hit = Object.entries(bindings).find(([, v]) => v === combo);
  return hit ? (hit[0] as ShortcutAction) : null;
}
