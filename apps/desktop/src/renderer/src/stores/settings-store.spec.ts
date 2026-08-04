import { describe, it, expect } from 'vitest';
import { createSettingsStore } from './settings-store';

describe('renderer settings store', () => {
  it('initializes with defaults', () => {
    const s = createSettingsStore({
      settingsGet: () => Promise.resolve(null),
      settingsSet: () => Promise.resolve()
    });
    expect(s.getState().language).toBe('zh-CN');
  });

  it('setLanguage persists', async () => {
    let persisted: unknown;
    const s = createSettingsStore({
      settingsGet: () => Promise.resolve(null),
      settingsSet: async (_k: string, v: unknown) => { persisted = v; }
    });
    await s.getState().setLanguage('en');
    expect(persisted).toBe('en');
    expect(s.getState().language).toBe('en');
  });
});
