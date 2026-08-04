import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { getResources } from '@jarvis/i18n';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { ChatPage } from './ChatPage';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
  (window as unknown as { jarvis: unknown }).jarvis = {
    invoke: async (method: string, ..._a: unknown[]) => {
      if (method === 'chat.listSessions') return [];
      if (method === 'chat.createSession') return { id: 's1', title: '', createdAt: '', updatedAt: '' };
      if (method === 'chat.loadMessages') return [];
      if (method === 'chat.send') return { ok: true };
      return null;
    },
    onDidReceive: () => () => {}
  };
});

describe('ChatPage', () => {
  it('renders and accepts input', async () => {
    render(<ChatPage />);
    await waitFor(() => expect(screen.getByTestId('chat-input')).toBeTruthy());
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByTestId('chat-send'));
  });
});
