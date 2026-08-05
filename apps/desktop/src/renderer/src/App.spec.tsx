import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import App from './App';
import { useSettings } from './stores/settings-store';
import { useSquadStore } from './stores/squad-store';

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
      if (method === 'squad.current') return { ok: true, squad: null };
      return null;
    },
    onDidReceive: () => () => {}
  };
});

describe('App', () => {
  // The squad view test mutates the shared zustand store, which re-renders a
  // stale mounted App tree if any was left behind; unmount between tests so
  // each assertion sees only its own DOM.
  afterEach(() => { cleanup(); });

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

  // M6 Task 10 review finding: the App-root global ApprovalPanel and the
  // SquadViewPage's own full-data panel must not BOTH render on /squad. The
  // root panel is route-aware: shown on every route, suppressed on /squad where
  // the page owns the F15 surface.
  it('suppresses the root ApprovalPanel on /squad (the page owns F15 there)', () => {
    useSettings.setState({ onboardingDone: true });
    useSquadStore.setState({ review: { id: 'sq-1', summary: 'plan', members: [] } });
    // On the home route the root F15 panel is shown.
    window.history.replaceState({}, '', '/');
    render(<App />);
    expect(screen.getByTestId('approval-panel')).toBeTruthy();
    cleanup();
    // On /squad the root panel is suppressed (the page renders its own); the
    // squad view loads the empty current-squad state from the mocked bridge.
    window.history.replaceState({}, '', '/squad');
    render(<App />);
    expect(screen.queryByTestId('approval-panel')).toBeNull();
    expect(screen.getByTestId('squad-view')).toBeTruthy();
  });
});
