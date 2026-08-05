import { describe, it, expect } from 'vitest';
import { DEFAULT_SHORTCUTS, normalizeCombo, lookup, parseBinding, type ShortcutAction } from './ShortcutMap';

describe('ShortcutMap', () => {
  it('has defaults for all actions', () => {
    for (const a of Object.keys(DEFAULT_SHORTCUTS)) expect(DEFAULT_SHORTCUTS[a as ShortcutAction]).toBeTruthy();
  });
  it('normalizes meta to Cmd and ctrl to Ctrl', () => {
    expect(normalizeCombo({ key: 'k', metaKey: true })).toBe('Cmd+K');
    expect(normalizeCombo({ key: 'Enter', ctrlKey: true, shiftKey: true })).toBe('Ctrl+Shift+Enter');
  });
  it('lookup finds the bound action', () => {
    const combo = normalizeCombo({ key: 'k', metaKey: true });
    expect(lookup(DEFAULT_SHORTCUTS, combo)).toBe('chat.new');
  });
  it('lookup returns null for unbound', () => {
    expect(lookup(DEFAULT_SHORTCUTS, 'F9')).toBeNull();
  });
  it('parseBinding normalizes a free-text binding into a combo', () => {
    expect(parseBinding(' cmd + enter ')).toBe('Cmd+Enter');
    expect(parseBinding('ctrl+shift+p')).toBe('Ctrl+Shift+P');
    expect(parseBinding('esc')).toBe('Esc');
    expect(parseBinding('Cmd+L')).toBe('Cmd+L');
  });
});
