import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { APP_DISPLAY_NAME, APP_VERSION, GITHUB_ISSUES_URL, GITHUB_WIKI_URL } from '@jarvis/protocol';
import { AppLayout } from './AppLayout';
import { SettingsLayout } from './SettingsLayout';
import { useAgentStore } from '../stores/agent-store';
import { useChatStore } from '../stores/chat-store';

function defaultInvoke(method: string, _payload?: unknown) {
  if (method === 'agent.list') return [];
  if (method === 'chat.listSessions') return [{ id: 's1', title: 'Hello', createdAt: '', updatedAt: '' }];
  if (method === 'chat.createSession') return { id: 's2', title: '', createdAt: '', updatedAt: '' };
  if (method === 'chat.loadMessages') return [];
  if (method === 'chat.renameSession') {
    const { sessionId, title } = (_payload ?? {}) as { sessionId: string; title: string };
    return { id: sessionId, title, createdAt: '', updatedAt: '' };
  }
  if (method === 'window.getChrome') {
    return { fullscreen: false, titleInset: 80, trafficLight: { x: 14, y: 18 } };
  }
  return [];
}

beforeAll(async () => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  });
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
  (window as unknown as { jarvis: unknown }).jarvis = {
    invoke: vi.fn(async (method: string, payload?: unknown) => defaultInvoke(method, payload)),
    onDidReceive: () => () => {}
  };
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  useAgentStore.setState({ agents: [], current: null });
  useChatStore.setState({ sessionId: null, sessions: [], messages: [], streaming: false, streamingText: '' });
  const invoke = (window as unknown as { jarvis: { invoke: ReturnType<typeof vi.fn> } }).jarvis.invoke;
  invoke.mockReset();
  invoke.mockImplementation(async (method: string, payload?: unknown) => defaultInvoke(method, payload));
});

function renderShell(initial = '/') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<div data-testid="child">child</div>} />
          <Route path="/settings" element={<SettingsLayout />}>
            <Route path="providers" element={<div data-testid="settings">settings</div>} />
          </Route>
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('AppLayout', () => {
  it('renders shell with Cursor-like chrome', async () => {
    renderShell();
    expect(screen.getByTestId('app-shell')).toBeTruthy();
    expect(screen.queryByTestId('sidebar-brand')).toBeNull();
    expect(screen.queryByTestId('sidebar-brand-title')).toBeNull();
    expect(screen.getByTestId('sidebar-footer-title').textContent).toBe(
      `${APP_DISPLAY_NAME} / 版本：${APP_VERSION}`,
    );
    expect(screen.getByTestId('sidebar-new-chat')).toBeTruthy();
    expect(screen.getByTestId('sidebar-search-toggle')).toBeTruthy();
    expect(screen.getByTestId('sidebar-settings-gear')).toBeTruthy();
    expect(screen.queryByTestId('language-switcher')).toBeNull();
    expect(screen.queryByTestId('nav-settings')).toBeNull();
    expect(screen.getByTestId('shell-repo-link')).toBeTruthy();
    expect(screen.queryByTestId('shell-repo-url')).toBeNull();
    const issues = screen.getByTestId('shell-issues-url') as HTMLAnchorElement;
    const wiki = screen.getByTestId('shell-wiki-url') as HTMLAnchorElement;
    expect(issues.getAttribute('href')).toBe(GITHUB_ISSUES_URL);
    expect(wiki.getAttribute('href')).toBe(GITHUB_WIKI_URL);
    await waitFor(() => expect(screen.getByTestId('sidebar-chat-s1')).toBeTruthy());
    expect(screen.getByTestId('child')).toBeTruthy();
  });

  it('opens settings from the gear button', async () => {
    renderShell();
    fireEvent.click(screen.getByTestId('sidebar-settings-gear'));
    await waitFor(() => expect(screen.getByTestId('settings')).toBeTruthy());
  });

  it('replaces the app sidebar with settings nav (not a third column)', async () => {
    renderShell('/settings/providers');
    await waitFor(() => expect(screen.getByTestId('settings-sidebar-nav')).toBeTruthy());
    expect(screen.getByTestId('settings-layout')).toBeTruthy();
    expect(screen.getByTestId('app-shell').className).toMatch(/app-shell-root--settings/);
    expect(screen.queryByTestId('settings-layout__nav')).toBeNull();
    expect(document.querySelector('.settings-layout__nav')).toBeNull();
    expect(screen.queryByTestId('sidebar-new-chat')).toBeNull();
    expect(screen.queryByTestId('nav-agents')).toBeNull();
    // Settings hides chat-runtime chrome in the top bar.
    expect(screen.queryByTestId('agent-switcher')).toBeNull();
    expect(screen.queryByTestId('mode-indicator')).toBeNull();
    expect(screen.queryByTestId('task-control')).toBeNull();
    expect(screen.getByTestId('settings-topbar-title').textContent).toBe('设置');
    expect(screen.getByTestId('settings-nav-providers').querySelector('.shell-icon')).toBeTruthy();
    expect(screen.getByTestId('settings-nav-mcp').querySelector('.shell-icon')).toBeTruthy();
    // Back sits in the titlebar row (same height as collapse), flush right.
    const titlebar = screen.getByTestId('sidebar-titlebar');
    expect(titlebar.className).toMatch(/sidebar-titlebar--settings/);
    expect(titlebar.contains(screen.getByTestId('settings-back'))).toBe(true);
    fireEvent.click(screen.getByTestId('settings-back'));
    await waitFor(() => expect(screen.getByTestId('child')).toBeTruthy());
    expect(screen.queryByTestId('settings-sidebar-nav')).toBeNull();
    expect(screen.queryByTestId('settings-back')).toBeNull();
    expect(screen.getByTestId('sidebar-new-chat')).toBeTruthy();
  });

  it('opens floating search palette when search is clicked', () => {
    renderShell();
    fireEvent.click(screen.getByTestId('sidebar-search-toggle'));
    expect(screen.getByTestId('shell-search-palette')).toBeTruthy();
    expect(screen.getByTestId('shell-palette-input')).toBeTruthy();
    expect(screen.queryByTestId('sidebar-search-input')).toBeNull();
  });

  it('hides menu content on collapse but keeps the traffic-bar toggle', () => {
    renderShell();
    const root = screen.getByTestId('app-shell');
    expect(screen.getByTestId('sidebar-resize-handle')).toBeTruthy();
    expect(screen.queryByTestId('main-resize-handle')).toBeNull();
    expect(screen.getByTestId('sidebar-new-chat')).toBeTruthy();
    expect(root.className).not.toMatch(/sidebar-collapsed/);
    fireEvent.click(screen.getByTestId('sidebar-collapse-toggle'));
    expect(root.className).toMatch(/sidebar-collapsed/);
    expect(root.style.getPropertyValue('--shell-sidebar-width')).toBe('0px');
    expect(screen.queryByTestId('sidebar-resize-handle')).toBeNull();
    expect(screen.queryByTestId('sidebar-new-chat')).toBeNull();
    expect(screen.queryByTestId('sidebar-footer-title')).toBeNull();
    // Toggle stays next to traffic lights.
    expect(screen.getByTestId('sidebar-collapse-toggle')).toBeTruthy();
    expect(screen.getByTestId('window-title-chrome')).toBeTruthy();
    fireEvent.click(screen.getByTestId('sidebar-collapse-toggle'));
    expect(root.className).not.toMatch(/sidebar-collapsed/);
    expect(screen.getByTestId('sidebar-new-chat')).toBeTruthy();
    expect(screen.getByTestId('sidebar-resize-handle')).toBeTruthy();
  });

  it('renders icons on primary More menu items', () => {
    renderShell();
    const agents = screen.getByTestId('nav-agents');
    expect(agents.querySelector('.shell-icon')).toBeTruthy();
    expect(screen.getByTestId('nav-board').querySelector('.shell-icon')).toBeTruthy();
    expect(screen.getByTestId('nav-coding').querySelector('.shell-icon')).toBeTruthy();
  });

  it('asks for confirmation before deleting a chat session', async () => {
    const invoke = (window as unknown as { jarvis: { invoke: ReturnType<typeof vi.fn> } }).jarvis.invoke;
    renderShell();
    await waitFor(() => expect(screen.getByTestId('sidebar-chat-delete-s1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('sidebar-chat-delete-s1'));
    expect(screen.getByTestId('chat-delete-confirm')).toBeTruthy();
    fireEvent.click(screen.getByTestId('chat-delete-confirm-btn'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('chat.deleteSession', 's1'));
  });

  it('pins and unpins a chat from the sidebar row', async () => {
    renderShell();
    await waitFor(() => expect(screen.getByTestId('sidebar-chat-pin-s1')).toBeTruthy());
    const pin = screen.getByTestId('sidebar-chat-pin-s1');
    expect(pin.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(pin);
    expect(pin.getAttribute('aria-pressed')).toBe('true');
    expect(pin.className).toMatch(/sidebar-pin-btn--on/);
    fireEvent.click(pin);
    expect(pin.getAttribute('aria-pressed')).toBe('false');
  });

  it('renames a chat title on double-click Enter', async () => {
    const invoke = (window as unknown as { jarvis: { invoke: ReturnType<typeof vi.fn> } }).jarvis.invoke;
    let sessions = [{ id: 's1', title: 'Hello', createdAt: '', updatedAt: '' }];
    invoke.mockImplementation(async (method: string, payload?: unknown) => {
      if (method === 'chat.listSessions') return sessions;
      if (method === 'chat.renameSession') {
        const { sessionId, title } = payload as { sessionId: string; title: string };
        sessions = [{ id: sessionId, title, createdAt: '', updatedAt: '' }];
        return sessions[0];
      }
      return defaultInvoke(method, payload);
    });
    renderShell();
    await waitFor(() => expect(screen.getByTestId('sidebar-chat-s1')).toBeTruthy());
    fireEvent.doubleClick(screen.getByTestId('sidebar-chat-title-s1'));
    const input = screen.getByTestId('sidebar-chat-rename-s1') as HTMLInputElement;
    expect(input.value).toBe('Hello');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('chat.renameSession', { sessionId: 's1', title: 'Renamed' }));
    await waitFor(() => expect(screen.getByTestId('sidebar-chat-title-s1').textContent).toBe('Renamed'));
  });

  it('cancels chat rename on Escape', async () => {
    renderShell();
    await waitFor(() => expect(screen.getByTestId('sidebar-chat-s1')).toBeTruthy());
    fireEvent.doubleClick(screen.getByTestId('sidebar-chat-title-s1'));
    const input = screen.getByTestId('sidebar-chat-rename-s1') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Nope' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('sidebar-chat-rename-s1')).toBeNull());
    expect(screen.getByTestId('sidebar-chat-title-s1').textContent).toBe('Hello');
  });
});
