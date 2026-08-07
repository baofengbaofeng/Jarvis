import { describe, it, expect } from 'vitest';
import { isAllowedSettingsKey, validateSettingsValue, requiresSystemConfirm } from './settings-schema';

describe('settings-schema (DESK-02)', () => {
  it('rejects unknown keys', () => {
    expect(isAllowedSettingsKey('evil.key')).toBe(false);
    expect(validateSettingsValue('evil.key', 1)).toEqual({ ok: false, error: 'SETTINGS_KEY_INVALID' });
  });

  it('accepts permissions.* with valid level', () => {
    const r = validateSettingsValue('permissions.a1', { level: 'readwrite', allowCommands: [], allowDomains: [] });
    expect(r.ok).toBe(true);
  });

  it('rejects invalid permissions level', () => {
    expect(validateSettingsValue('permissions.a1', { level: 'god' }).ok).toBe(false);
  });

  it('requires confirmSystem for level system', () => {
    expect(requiresSystemConfirm('permissions.a1', { level: 'system' })).toBe(true);
    expect(requiresSystemConfirm('permissions.a1', { level: 'system', confirmSystem: true })).toBe(false);
  });

  it('clamps concurrency', () => {
    expect(validateSettingsValue('concurrency.per_agent', 0).ok).toBe(false);
    expect(validateSettingsValue('concurrency.per_agent', 4)).toEqual({ ok: true, value: 4 });
  });
});
