import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import App from './App';
import { useSettings } from './stores/settings-store';

beforeAll(async () => {
  // jsdom does not implement window.matchMedia; the real ThemeProvider
  // (Task 7) reads it to resolve the 'system' theme, so stub it to "light".
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    })
  });
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
  // The rewritten ChatPage (Task 8) calls window.jarvis.invoke('chat.listSessions')
  // from its useEffect init(); without a bridge mock it throws and the
  // "renders chat page when onboarding is done" case regresses.
  (window as unknown as { jarvis: unknown }).jarvis = {
    invoke: async (method: string, ..._args: unknown[]) => {
      if (method === 'agent.list') return [];
      if (method === 'chat.listSessions') return [];
      if (method === 'chat.createSession') return { id: 's1', title: '', createdAt: '', updatedAt: '' };
      if (method === 'chat.loadMessages') return [];
      if (method === 'chat.send') return { ok: true };
      return null;
    },
    onDidReceive: () => () => {}
  };
});

describe('App', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('redirects to onboarding when onboarding is not done', () => {
    useSettings.setState({ onboardingDone: false });
    render(<App />);
    expect(screen.getByTestId('onboarding')).toBeTruthy();
  });

  it('renders chat page when onboarding is done', () => {
    useSettings.setState({ onboardingDone: true });
    render(<App />);
    expect(screen.getByTestId('chat-page')).toBeTruthy();
  });
});
