import { describe, it, expect, vi } from 'vitest';
import {
  createHealthPoller,
  createRuntimePoller,
  buildDaemonEnv,
  resolveDaemonAuthToken,
  type RuntimeStatusData,
  type ConflictItem,
} from './DaemonSupervisor';

describe('createHealthPoller', () => {
  it('calls onReady when health ok', async () => {
    const onReady = vi.fn();
    const p = createHealthPoller({ port: 17890, intervalMs: 10, fetchImpl: async () => ({ ok: true }) });
    await p.start(onReady);
    expect(onReady).toHaveBeenCalled();
    p.stop();
  });
});

describe('createRuntimePoller', () => {
  it('polls status/conflicts and derives mode from registered/busy', async () => {
    const fetchImpl = vi.fn(async (url: string): Promise<{ ok: boolean; json: () => Promise<unknown> }> => {
      if (url.endsWith('/runtime/status')) {
        return { ok: true, json: async () => ({ registered: true, busy: true, activeTasks: 1, lastHeartbeatAt: 5, serverUrl: 'https://m.example', protocol: 'acp' }) };
      }
      return { ok: true, json: async () => [{ taskId: 't1', resolved: false }] };
    });
    const onStatus = vi.fn();
    const onConflicts = vi.fn();
    const p = createRuntimePoller({
      port: 17890,
      intervalMs: 10,
      fetchImpl,
      onStatus,
      onConflicts,
    });
    await p.start();
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:17890/runtime/status');
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:17890/runtime/conflicts');
    const data = onStatus.mock.calls[0][0] as RuntimeStatusData;
    expect(data.mode).toBe('runtime_busy');
    expect(onConflicts.mock.calls[0][0] as ConflictItem[]).toHaveLength(1);
    p.stop();
  });
});

describe('buildDaemonEnv', () => {
  it('injects saved concurrency limits into the daemon env', () => {
    const env = buildDaemonEnv({ PATH: '/usr/bin' }, 17890, { perAgent: 4, machine: 10 }, 'tok');
    expect(env.JARVIS_DAEMON_PORT).toBe('17890');
    expect(env.JARVIS_CONCURRENCY_PER_AGENT).toBe('4');
    expect(env.JARVIS_CONCURRENCY_MACHINE).toBe('10');
    expect(env.JARVIS_DAEMON_TOKEN).toBe('tok');
    expect(env.PATH).toBe('/usr/bin'); // base env is preserved
  });

  it('falls back to 6/20 when no concurrency is configured', () => {
    const env = buildDaemonEnv({}, 17890, {}, 'tok');
    expect(env.JARVIS_CONCURRENCY_PER_AGENT).toBe('6');
    expect(env.JARVIS_CONCURRENCY_MACHINE).toBe('20');
  });

  it('always forwards the shared auth token for injection approvals', () => {
    const env = buildDaemonEnv({ JARVIS_DAEMON_TOKEN: 'stale' }, 17890, {}, 'fresh-secret');
    expect(env.JARVIS_DAEMON_TOKEN).toBe('fresh-secret');
  });
});

describe('resolveDaemonAuthToken', () => {
  it('reuses JARVIS_DAEMON_TOKEN when already set', () => {
    expect(resolveDaemonAuthToken({ JARVIS_DAEMON_TOKEN: ' from-env ' })).toBe('from-env');
  });

  it('mints a non-empty token when unset', () => {
    const a = resolveDaemonAuthToken({});
    const b = resolveDaemonAuthToken({});
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(b.length).toBeGreaterThanOrEqual(32);
    expect(a).not.toBe(b);
  });
});

describe('defaultDaemonBinaryPath (BUILD-04)', () => {
  it('appends .exe on win32', async () => {
    const { defaultDaemonBinaryPath: pathFor } = await import('./DaemonSupervisor');
    expect(pathFor('/app/out/main', 'win32')).toMatch(/jarvis-daemon\.exe$/);
  });

  it('uses process.resourcesPath when packaged', async () => {
    const { defaultDaemonBinaryPath: pathFor } = await import('./DaemonSupervisor');
    expect(pathFor('/x', 'linux', true, '/Resources')).toBe('/Resources/daemon/jarvis-daemon');
  });
});

describe('defaultCoreEntryPath / buildDaemonEnv (DAEM-01)', () => {
  it('resolves an absolute headless.mjs path in dev', async () => {
    const { defaultCoreEntryPath } = await import('./DaemonSupervisor');
    const p = defaultCoreEntryPath('/app/out/main', false, '');
    expect(p.startsWith('/')).toBe(true);
    expect(p.endsWith('packages/core/dist/headless.mjs') || p.endsWith('core/headless.mjs')).toBe(true);
  });

  it('uses process.resourcesPath when packaged', async () => {
    const { defaultCoreEntryPath } = await import('./DaemonSupervisor');
    expect(defaultCoreEntryPath('/x', true, '/Resources')).toBe('/Resources/core/headless.mjs');
  });

  it('injects absolute JARVIS_CORE_ENTRY into daemon env', async () => {
    const { buildDaemonEnv } = await import('./DaemonSupervisor');
    const env = buildDaemonEnv({ PATH: '/usr/bin' }, 17890, {}, 'tok', '/abs/packages/core/dist/headless.mjs');
    expect(env.JARVIS_CORE_ENTRY).toBe('/abs/packages/core/dist/headless.mjs');
  });
});
