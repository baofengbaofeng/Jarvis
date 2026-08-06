import { describe, it, expect } from 'vitest';
import { createThemeStore } from './theme-store';

describe('theme store', () => {
  it('defaults mode to light', () => {
    const s = createThemeStore(() => true);
    expect(s.getState().mode).toBe('light');
  });
  it('resolves system to light when media matches light', () => {
    const s = createThemeStore(() => false);
    expect(s.getState().resolved('system')).toBe('light');
  });
  it('resolves explicit dark', () => {
    const s = createThemeStore(() => false);
    expect(s.getState().resolved('dark')).toBe('dark');
  });
});
