import { describe, it, expect, vi } from 'vitest';
import { createHealthPoller, buildDaemonEnv } from './DaemonSupervisor';

describe('createHealthPoller', () => {
  it('calls onReady when health ok', async () => {
    const onReady = vi.fn();
    const p = createHealthPoller({ port: 17890, intervalMs: 10, fetchImpl: async () => ({ ok: true }) });
    await p.start(onReady);
    expect(onReady).toHaveBeenCalled();
    p.stop();
  });
});

describe('buildDaemonEnv', () => {
  it('injects saved concurrency limits into the daemon env', () => {
    const env = buildDaemonEnv({ PATH: '/usr/bin' }, 17890, { perAgent: 4, machine: 10 });
    expect(env.JARVIS_DAEMON_PORT).toBe('17890');
    expect(env.JARVIS_CONCURRENCY_PER_AGENT).toBe('4');
    expect(env.JARVIS_CONCURRENCY_MACHINE).toBe('10');
    expect(env.PATH).toBe('/usr/bin'); // base env is preserved
  });

  it('falls back to 6/20 when no concurrency is configured', () => {
    const env = buildDaemonEnv({}, 17890, {});
    expect(env.JARVIS_CONCURRENCY_PER_AGENT).toBe('6');
    expect(env.JARVIS_CONCURRENCY_MACHINE).toBe('20');
  });
});
