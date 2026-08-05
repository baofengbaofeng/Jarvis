import { describe, it, expect, beforeEach, vi } from 'vitest';
import { deriveMode } from './runtime-store';

describe('deriveMode (L39)', () => {
  it('maps registered/busy to the three runtime modes', () => {
    expect(deriveMode(false, false)).toBe('local');
    expect(deriveMode(true, false)).toBe('runtime_registered');
    expect(deriveMode(true, true)).toBe('runtime_busy');
  });
});

describe('runtime store', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      jarvis: { invoke: vi.fn(async () => ({ registered: true, busy: false, activeTasks: 2, lastHeartbeatAt: 0, serverUrl: 'https://multica.example', protocol: 'acp', mode: 'runtime_registered' })) },
    });
  });
  it('refreshes status from the runtime.status IPC', async () => {
    const { useRuntimeStore } = await import('./runtime-store');
    const store = useRuntimeStore.getState();
    await store.refresh();
    expect(useRuntimeStore.getState().status?.serverUrl).toBe('https://multica.example');
    expect(useRuntimeStore.getState().status?.mode).toBe('runtime_registered');
  });
});
