import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { getResources } from '@jarvis/i18n';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { ChatPage } from './ChatPage';
import { useChatStore } from '../stores/chat-store';
import { useAgentStore } from '../stores/agent-store';

const AGENT = { id: 'a1', name: 'Coder', slug: 'coder', description: '', systemPrompt: '', modelId: null, workspaceId: null, contextBudgetTokens: 1000, planOnly: false, createdAt: '', updatedAt: '' };

const SESSIONS = [
  { id: 's1', title: 'Session 1', createdAt: '', updatedAt: '' },
  { id: 's2', title: 'Session 2', createdAt: '', updatedAt: '' }
];

let taskCreateSpy: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
  taskCreateSpy = vi.fn(async () => ({ id: 't1' }));
  (window as unknown as { jarvis: unknown }).jarvis = {
    invoke: async (method: string, ..._a: unknown[]) => {
      if (method === 'agent.list') return [{ id: 'a1', name: 'Coder', slug: 'coder', description: '', systemPrompt: '', modelId: null, workspaceId: null, contextBudgetTokens: 1000, planOnly: false, createdAt: '', updatedAt: '' }];
      if (method === 'chat.listSessions') return SESSIONS;
      if (method === 'chat.createSession') return { id: 's3', title: '', createdAt: '', updatedAt: '' };
      if (method === 'chat.loadMessages') {
        return (_a[0] as string) === 's1'
          ? [{ id: 'm1', sessionId: 's1', role: 'user', content: 'hello from s1', createdAt: '' }]
          : [];
      }
      if (method === 'task.create') return taskCreateSpy(..._a);
      if (method === 'chat.send') return { ok: true };
      return null;
    },
    onDidReceive: () => () => {}
  };
});

beforeEach(() => {
  useChatStore.setState({ sessionId: null, sessions: [], messages: [], streaming: false, streamingText: '', steps: [] });
  useAgentStore.setState({ agents: [AGENT], current: AGENT });
});

afterEach(() => {
  cleanup();
});

describe('ChatPage', () => {
  it('shows empty composer layout without an inner sessions sidebar', async () => {
    render(<ChatPage />);
    await waitFor(() => expect(screen.getByTestId('chat-input')).toBeTruthy());
    useChatStore.setState({ sessionId: 's2', messages: [], streamingText: '', steps: [] });
    await waitFor(() => expect(screen.getByTestId('chat-empty-composer')).toBeTruthy());
    expect(screen.queryByTestId('chat-sessions')).toBeNull();
    expect(screen.queryByTestId('chat-session-s1')).toBeNull();
  });

  it('renders and accepts input with an optimistic user message', async () => {
    render(<ChatPage />);
    await waitFor(() => expect(useChatStore.getState().sessionId).toBeTruthy());
    useChatStore.setState({
      sessionId: 's1',
      messages: [],
      sessions: SESSIONS,
      streaming: false,
      streamingText: '',
      steps: [],
    });
    await waitFor(() => expect(screen.getByTestId('chat-empty-composer')).toBeTruthy());
    const input = screen.getByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'hello' } });
    expect((input as HTMLTextAreaElement).value).toBe('hello');
    fireEvent.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy());
  });

  it('routes the chat send through the task execution path', async () => {
    taskCreateSpy.mockClear();
    render(<ChatPage />);
    await waitFor(() => expect(useChatStore.getState().sessionId).toBeTruthy());
    useChatStore.setState({
      sessionId: 's1',
      messages: [],
      sessions: SESSIONS,
      streaming: false,
      streamingText: '',
      steps: [],
    });
    await waitFor(() => expect(screen.getByTestId('chat-empty-composer')).toBeTruthy());
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(taskCreateSpy).toHaveBeenCalledWith({ agentId: 'a1', prompt: 'hello', sessionId: 's1' }));
  });

  it('shows loaded session messages in the active layout', async () => {
    render(<ChatPage />);
    await waitFor(() => expect(screen.getByText('hello from s1')).toBeTruthy());
    expect(screen.queryByTestId('chat-empty-composer')).toBeNull();
    expect(screen.getByTestId('chat-page').className).toMatch(/chat-page--active/);
  });
});
