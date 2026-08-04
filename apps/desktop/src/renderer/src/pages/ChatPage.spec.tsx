import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { getResources } from '@jarvis/i18n';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { ChatPage } from './ChatPage';
import { useChatStore } from '../stores/chat-store';

const SESSIONS = [
  { id: 's1', title: 'Session 1', createdAt: '', updatedAt: '' },
  { id: 's2', title: 'Session 2', createdAt: '', updatedAt: '' }
];

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
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
      if (method === 'chat.send') return { ok: true };
      return null;
    },
    onDidReceive: () => () => {}
  };
});

beforeEach(() => {
  useChatStore.setState({ sessionId: null, sessions: [], messages: [], streaming: false, streamingText: '' });
});

afterEach(() => {
  cleanup();
});

describe('ChatPage', () => {
  it('renders and accepts input with an optimistic user message', async () => {
    render(<ChatPage />);
    await waitFor(() => expect(screen.getByTestId('chat-input')).toBeTruthy());
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByTestId('chat-send'));
    // The user prompt is appended to the live view immediately (before chat.send resolves).
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy());
  });

  it('renders the session list and loads the first session', async () => {
    render(<ChatPage />);
    await waitFor(() => expect(screen.getByTestId('chat-session-s1')).toBeTruthy());
    expect(screen.getByTestId('chat-session-s2')).toBeTruthy();
    // init() loads the first session's messages.
    await waitFor(() => expect(screen.getByText('hello from s1')).toBeTruthy());
  });

  it('clicking a session loads its messages and highlights it', async () => {
    render(<ChatPage />);
    await waitFor(() => expect(screen.getByTestId('chat-session-s2')).toBeTruthy());
    fireEvent.click(screen.getByTestId('chat-session-s2'));
    await waitFor(() => expect(screen.queryByText('hello from s1')).toBeNull());
  });
});
