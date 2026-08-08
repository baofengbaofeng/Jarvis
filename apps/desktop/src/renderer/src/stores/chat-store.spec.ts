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
      steps: [],
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

  it('deleteSession removes the row and does not auto-create a replacement', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === IpcChannel.chatDeleteSession) return undefined;
      if (channel === IpcChannel.chatListSessions) return [];
      return null;
    });
    useChatStore.setState({
      sessionId: 'sess-1',
      sessions: [{ id: 'sess-1', title: '新对话', createdAt: '', updatedAt: '' }],
      messages: [{ id: 'm1', sessionId: 'sess-1', role: 'user', content: 'hi', createdAt: '' }],
    });
    await useChatStore.getState().deleteSession('sess-1');
    expect(invoke).toHaveBeenCalledWith(IpcChannel.chatDeleteSession, 'sess-1');
    expect(useChatStore.getState().sessions).toEqual([]);
    expect(useChatStore.getState().sessionId).toBeNull();
    expect(useChatStore.getState().messages).toEqual([]);
    expect(invoke.mock.calls.some((c) => c[0] === IpcChannel.chatCreateSession)).toBe(false);
  });

  it('renameSession updates the session title in the list', async () => {
    invoke.mockImplementation(async (channel: string, payload?: unknown) => {
      if (channel === IpcChannel.chatRenameSession) {
        const { sessionId, title } = payload as { sessionId: string; title: string };
        return { id: sessionId, title, createdAt: '', updatedAt: 'now' };
      }
      if (channel === IpcChannel.chatListSessions) {
        return [{ id: 'sess-1', title: 'Renamed', createdAt: '', updatedAt: 'now' }];
      }
      return null;
    });
    useChatStore.setState({
      sessionId: 'sess-1',
      sessions: [{ id: 'sess-1', title: 'Old', createdAt: '', updatedAt: '' }],
    });
    await useChatStore.getState().renameSession('sess-1', 'Renamed');
    expect(invoke).toHaveBeenCalledWith(IpcChannel.chatRenameSession, { sessionId: 'sess-1', title: 'Renamed' });
    expect(useChatStore.getState().sessions[0].title).toBe('Renamed');
  });
});
