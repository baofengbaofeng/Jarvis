import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18n from 'i18next';
import { getResources } from '@jarvis/i18n';
import { RuntimeStatusView } from './RuntimeStatusView';

describe('RuntimeStatusView', () => {
  beforeAll(async () => {
    // The component translates via useTranslation('common'); init the real
    // resource bundle so t() resolves instead of returning raw keys.
    await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
  });
  beforeEach(() => {
    // Assign jarvis on the real jsdom window rather than stubbing the whole
    // window global: @testing-library/dom's waitFor reads window.document, so a
    // stubGlobal replacing window would leave it undefined and break queries.
    (window as unknown as { jarvis: unknown }).jarvis = {
      invoke: vi.fn(async () => ({ registered: true, busy: false, activeTasks: 2, lastHeartbeatAt: 0, serverUrl: 'https://multica.example', protocol: 'acp', mode: 'runtime_registered' })),
    };
  });
  it('renders runtime registration status', async () => {
    render(<I18nextProvider i18n={i18n}><RuntimeStatusView /></I18nextProvider>);
    expect(await screen.findByTestId('runtime-status')).toBeTruthy();
  });
});
