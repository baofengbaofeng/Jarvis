import { describe, it, expect } from 'vitest';
import { registerRuntimeHandlers, deriveRuntimeMode, type RuntimeStatusData } from './runtime';

describe('runtime ipc', () => {
  it('exposes status/conflicts and persists conflict decisions', async () => {
    const calls = new Map<string, unknown[]>();
    const settings = new Map<string, unknown>();
    const register = (ch: string, h: (...a: any[]) => unknown) => calls.set(ch, [h]);
    const status: RuntimeStatusData = { registered: true, busy: false, activeTasks: 0, lastHeartbeatAt: 0, serverUrl: 's', protocol: 'acp', mode: 'runtime_registered' };
    registerRuntimeHandlers(
      register,
      () => status,
      () => [],
      { get: (k) => settings.get(k), set: (k, v) => void settings.set(k, v) },
    );
    const statusH = calls.get('runtime.status')?.[0] as () => RuntimeStatusData;
    expect(statusH().mode).toBe('runtime_registered');
    const resolveH = calls.get('runtime.resolveConflict')?.[0] as (e: unknown, a: { name: string; decision: string }) => unknown;
    await resolveH({}, { name: 'review', decision: 'local' });
    expect((settings.get('multica.conflicts') as Record<string, string>).review).toBe('local');
  });
  it('derives the three modes', () => {
    expect(deriveRuntimeMode(false, false)).toBe('local');
    expect(deriveRuntimeMode(true, false)).toBe('runtime_registered');
    expect(deriveRuntimeMode(true, true)).toBe('runtime_busy');
  });
});
