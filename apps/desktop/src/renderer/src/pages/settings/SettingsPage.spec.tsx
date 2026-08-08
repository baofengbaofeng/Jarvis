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
  it('ProviderSettingsPage shows description and always-on add form', () => {
    (window as unknown as { jarvis: unknown }).jarvis = {
      invoke: async (method: string) => (method === 'provider.list' ? [] : []),
      settingsGet: async () => null,
      settingsSet: async () => {},
      onDidReceive: () => () => {}
    };
    render(<ProviderSettingsPage />);
    expect(screen.getByText('供应商添加')).toBeTruthy();
    expect(screen.getByText(/在此配置大模型供应商/)).toBeTruthy();
    expect(screen.getByTestId('provider-add-area')).toBeTruthy();
    expect(screen.getByTestId('provider-form')).toBeTruthy();
    expect(screen.queryByTestId('provider-add-open')).toBeNull();
    expect(screen.getByTestId('provider-list-section')).toBeTruthy();
    expect(screen.getByText('供应商列表')).toBeTruthy();
  });
  it('LogPanelPage renders', () => {
    render(<LogPanelPage />);
    expect(screen.getByTestId('log-panel')).toBeTruthy();
  });
});
