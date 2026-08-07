import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { APP_VERSION, GITHUB_REPO_URL } from '@jarvis/protocol';
import { AppLayout } from './AppLayout';
import { useAgentStore } from '../stores/agent-store';
import { useChatStore } from '../stores/chat-store';

beforeAll(async () => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  });
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
  (window as unknown as { jarvis: unknown }).jarvis = {
    invoke: vi.fn(async (method: string) => {
      if (method === 'agent.list') return [];
      if (method === 'chat.listSessions') return [{ id: 's1', title: 'Hello', createdAt: '', updatedAt: '' }];
      if (method === 'chat.createSession') return { id: 's2', title: '', createdAt: '', updatedAt: '' };
      if (method === 'chat.loadMessages') return [];
      return [];
    }),
    onDidReceive: () => () => {}
  };
});

afterEach(() => {
  cleanup();
  useAgentStore.setState({ agents: [], current: null });
  useChatStore.setState({ sessionId: null, sessions: [], messages: [], streaming: false, streamingText: '' });
});

function renderShell(initial = '/') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<div data-testid="child">child</div>} />
          <Route path="/settings/providers" element={<div data-testid="settings">settings</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('AppLayout', () => {
  it('renders shell with Cursor-like chrome', async () => {
    renderShell();
    expect(screen.getByTestId('app-shell')).toBeTruthy();
    expect(screen.getByTestId('sidebar-brand-title').textContent).toBe(`JARVIS / ${APP_VERSION}`);
    expect(screen.getByTestId('sidebar-new-chat')).toBeTruthy();
    expect(screen.getByTestId('sidebar-search-toggle')).toBeTruthy();
    expect(screen.getByTestId('sidebar-settings-gear')).toBeTruthy();
    expect(screen.queryByTestId('language-switcher')).toBeNull();
    expect(screen.queryByTestId('nav-settings')).toBeNull();
    const link = screen.getByTestId('shell-repo-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(GITHUB_REPO_URL);
    expect(link.target).toBe('_blank');
    await waitFor(() => expect(screen.getByTestId('sidebar-chat-s1')).toBeTruthy());
    expect(screen.getByTestId('child')).toBeTruthy();
  });

  it('opens settings from the gear button', async () => {
    renderShell();
    fireEvent.click(screen.getByTestId('sidebar-settings-gear'));
    await waitFor(() => expect(screen.getByTestId('settings')).toBeTruthy());
  });

  it('expands search input when search is clicked', () => {
    renderShell();
    fireEvent.click(screen.getByTestId('sidebar-search-toggle'));
    expect(screen.getByTestId('sidebar-search-input')).toBeTruthy();
  });
});
