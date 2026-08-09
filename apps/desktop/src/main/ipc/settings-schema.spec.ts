import { describe, it, expect } from 'vitest';
import { isAllowedSettingsKey, validateSettingsValue, requiresSystemConfirm } from './settings-schema';

describe('settings-schema (DESK-02)', () => {
  it('rejects unknown keys', () => {
    expect(isAllowedSettingsKey('evil.key')).toBe(false);
    expect(validateSettingsValue('evil.key', 1)).toEqual({ ok: false, error: 'SETTINGS_KEY_INVALID' });
  });

  it('allows onboarding_done used by the renderer settings store', () => {
    expect(validateSettingsValue('onboarding_done', true)).toEqual({ ok: true, value: true });
  });

  it('accepts permissions.* with valid level', () => {
    const r = validateSettingsValue('permissions.a1', { level: 'readwrite', allowCommands: [], allowDomains: [] });
    expect(r.ok).toBe(true);
  });

  it('accepts non-default readonly permissions level', () => {
    const r = validateSettingsValue('permissions.a1', { level: 'readonly', allowCommands: [], allowDomains: [] });
    expect(r).toEqual({
      ok: true,
      value: { level: 'readonly', allowCommands: [], allowDomains: [] },
    });
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

  it('accepts mcp global settings keys', () => {
    expect(validateSettingsValue('mcp.auto_start', true)).toEqual({ ok: true, value: true });
    expect(validateSettingsValue('mcp.log_level', 'debug')).toEqual({ ok: true, value: 'debug' });
    expect(validateSettingsValue('mcp.max_concurrent_tools', 3)).toEqual({ ok: true, value: 3 });
    expect(validateSettingsValue('mcp.tool_warning_threshold', 10000)).toEqual({ ok: true, value: 10000 });
    expect(validateSettingsValue('mcp.global_env', { A: '1' }).ok).toBe(true);
    expect(validateSettingsValue('mcp.log_level', 'trace').ok).toBe(false);
  });
});
