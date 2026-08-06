import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IpcChannel, IpcEvent } from '@jarvis/protocol';
import { useChatStore } from './chat-store';
import { useTaskStore } from './task-store';
import { useAgentStore } from './agent-store';
import { initIpcSubscriptions, resetIpcSubscriptionsForTests } from './ipc-subscriptions';

describe('chat-store', () => {
  const handlers = new Map<string, (payload: unknown) => void>();
  const invoke = vi.fn();

  beforeEach(() => {
    resetIpcSubscriptionsForTests();
    handlers.clear();
    invoke.mockReset();
    useChatStore.setState({
      sessionId: 'sess-1',
      sessions: [],
      messages: [],
      streaming: false,
      streamingText: '',
      streamingTaskSessionId: null,
      pendingImages: []
    });
    useTaskStore.setState({ activeTaskId: null, status: null, logs: [] });
    useAgentStore.setState({
      agents: [],
      current: { id: 'agent-1', name: 'A', slug: 'a', description: '', systemPrompt: '', modelId: 'm1', workspaceId: null, contextBudgetTokens: 1000, planOnly: false, createdAt: '', updatedAt: '' }
    });
    (window as unknown as { jarvis: unknown }).jarvis = {
      invoke,
      onDidReceive: (channel: string, cb: (payload: unknown) => void) => {
        handlers.set(channel, cb);
        return () => handlers.delete(channel);
      }
    };
    initIpcSubscriptions();
  });

  it('appendDelta and finishStream build assistant message', () => {
    useChatStore.getState().appendDelta('hel');
    useChatStore.getState().appendDelta('lo');
    useChatStore.getState().finishStream();
    const msgs = useChatStore.getState().messages;
    expect(msgs[msgs.length - 1].content).toBe('hello');
    expect(useChatStore.getState().streaming).toBe(false);
  });

  it('routes task logs into streaming bubble for matching session', () => {
    useTaskStore.setState({ activeTaskId: 't-1' });
    useChatStore.setState({ streaming: true, streamingTaskSessionId: 'sess-1', sessionId: 'sess-1' });
    handlers.get(IpcEvent.taskLog)?.({ id: 't-1', line: 'step\n' });
    expect(useChatStore.getState().streamingText).toContain('step');
    expect(useTaskStore.getState().logs).toContain('step\n');
  });

  it('send creates task when agent is selected', async () => {
    invoke.mockResolvedValueOnce({ id: 't-new' });
    await useChatStore.getState().send('run tests');
    expect(invoke).toHaveBeenCalledWith(IpcChannel.taskCreate, { agentId: 'agent-1', prompt: 'run tests', sessionId: 'sess-1' });
    expect(useChatStore.getState().streaming).toBe(true);
  });
});
