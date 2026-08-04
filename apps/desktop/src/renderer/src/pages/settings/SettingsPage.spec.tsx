import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { ProviderSettingsPage } from './ProviderSettingsPage';
import { LogPanelPage } from './LogPanelPage';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

describe('settings pages', () => {
  it('ProviderSettingsPage shows empty state', () => {
    render(<ProviderSettingsPage />);
    expect(screen.getByText('尚未配置 Provider')).toBeTruthy();
  });
  it('LogPanelPage renders', () => {
    render(<LogPanelPage />);
    expect(screen.getByTestId('log-panel')).toBeTruthy();
  });
});
