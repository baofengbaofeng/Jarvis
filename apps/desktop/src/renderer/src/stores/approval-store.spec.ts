import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IpcChannel, IpcEvent } from '@jarvis/protocol';
import { useApprovalStore } from './approval-store';
import { initIpcSubscriptions, resetIpcSubscriptionsForTests } from './ipc-subscriptions';

describe('approval-store', () => {
  const handlers = new Map<string, (payload: unknown) => void>();
  const invoke = vi.fn(async () => ({ ok: true }));

  beforeEach(() => {
    resetIpcSubscriptionsForTests();
    handlers.clear();
    invoke.mockClear();
    useApprovalStore.setState({ pending: [] });
    (window as unknown as { jarvis: unknown }).jarvis = {
      invoke,
      onDidReceive: (channel: string, cb: (payload: unknown) => void) => {
        handlers.set(channel, cb);
        return () => handlers.delete(channel);
      }
    };
    initIpcSubscriptions();
  });

  it('queues approval requests from IPC', () => {
    handlers.get(IpcEvent.approvalRequest)?.({ id: 'a1', toolName: 'run_shell', args: {}, prompt: 'p' });
    expect(useApprovalStore.getState().pending).toHaveLength(1);
    expect(useApprovalStore.getState().pending[0].toolName).toBe('run_shell');
  });

  it('resolve invokes approval.resolve and removes pending row', async () => {
    useApprovalStore.setState({ pending: [{ id: 'a2', toolName: 'git_commit', args: {}, prompt: 'p' }] });
    await useApprovalStore.getState().resolve('a2', true);
    expect(invoke).toHaveBeenCalledWith(IpcChannel.approvalResolve, 'a2', true);
    expect(useApprovalStore.getState().pending).toHaveLength(0);
  });
});
