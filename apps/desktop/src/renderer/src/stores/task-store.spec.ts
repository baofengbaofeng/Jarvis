import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IpcChannel } from '@jarvis/protocol';
import { useTaskStore } from './task-store';

describe('task-store', () => {
  const invoke = vi.fn();

  beforeEach(() => {
    invoke.mockReset();
    useTaskStore.setState({ activeTaskId: null, status: null, logs: [] });
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
  });

  it('createTask stores active id and resets logs', async () => {
    invoke.mockResolvedValueOnce({ id: 't-1' });
    const id = await useTaskStore.getState().createTask('agent-1', 'hello', 'sess-1');
    expect(id).toBe('t-1');
    expect(invoke).toHaveBeenCalledWith(IpcChannel.taskCreate, { agentId: 'agent-1', prompt: 'hello', sessionId: 'sess-1' });
    expect(useTaskStore.getState().activeTaskId).toBe('t-1');
    expect(useTaskStore.getState().status).toBe('queued');
    expect(useTaskStore.getState().logs).toEqual([]);
  });

  it('cancel forwards to task.cancel when active', async () => {
    useTaskStore.setState({ activeTaskId: 't-2' });
    await useTaskStore.getState().cancel();
    expect(invoke).toHaveBeenCalledWith(IpcChannel.taskCancel, 't-2');
  });
});
