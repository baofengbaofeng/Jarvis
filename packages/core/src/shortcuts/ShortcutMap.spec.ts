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
  it('pins the Escape canonical form together across all producers', () => {
    // A real Escape keydown reports e.key === 'Escape'; normalizeCombo must
    // canonicalize it to the same 'Esc' the default binding and parseBinding use,
    // otherwise task.cancel silently never fires.
    expect(normalizeCombo({ key: 'Escape' })).toBe(DEFAULT_SHORTCUTS['task.cancel']);
    expect(parseBinding('esc')).toBe(DEFAULT_SHORTCUTS['task.cancel']);
    expect(normalizeCombo({ key: 'Escape' })).toBe(parseBinding('esc'));
  });
  it('named keys agree across normalizeCombo and parseBinding', () => {
    expect(normalizeCombo({ key: 'Enter' })).toBe('Enter');
    expect(normalizeCombo({ key: ' ' })).toBe('Space');
    expect(normalizeCombo({ key: 'ArrowUp' })).toBe('ArrowUp');
    expect(parseBinding('enter')).toBe('Enter');
    expect(parseBinding('space')).toBe('Space');
    expect(parseBinding('ArrowUp')).toBe('ArrowUp');
  });
});
