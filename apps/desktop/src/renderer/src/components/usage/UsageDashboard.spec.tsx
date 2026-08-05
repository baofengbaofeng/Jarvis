import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18n from 'i18next';
import { getResources } from '@jarvis/i18n';
import { UsageDashboard } from './UsageDashboard';

const summary = {
  total: { promptTokens: 1, completionTokens: 1, totalTokens: 2, calls: 2 },
  byAgent: [{ agentId: 'a1', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, calls: 2 } }],
};

describe('UsageDashboard', () => {
  beforeAll(async () => {
    // The component translates via useTranslation('common'); init the real
    // resource bundle so t() resolves instead of returning raw keys.
    await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
  });
  beforeEach(() => {
    (window as unknown as { jarvis: unknown }).jarvis = {
      invoke: vi.fn(async () => summary),
    };
  });
  afterEach(() => { cleanup(); });

  it('renders total tokens and agent rows from usage.summary', async () => {
    render(<I18nextProvider i18n={i18n}><UsageDashboard /></I18nextProvider>);
    await waitFor(() => expect(screen.getByTestId('usage-dashboard')).toBeTruthy());
    expect(screen.getByTestId('usage-total-tokens').textContent).toBe('2');
    expect(screen.getByText('a1')).toBeTruthy();
  });
});
