import { describe, it, expect, vi } from 'vitest';
import { createHealthPoller } from './DaemonSupervisor';

describe('createHealthPoller', () => {
  it('calls onReady when health ok', async () => {
    const onReady = vi.fn();
    const p = createHealthPoller({ port: 17890, intervalMs: 10, fetchImpl: async () => ({ ok: true }) });
    await p.start(onReady);
    expect(onReady).toHaveBeenCalled();
    p.stop();
  });
});
