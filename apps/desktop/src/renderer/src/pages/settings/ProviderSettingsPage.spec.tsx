import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { ProviderSettingsPage } from './ProviderSettingsPage';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

describe('ProviderSettingsPage', () => {
  it('renders created provider after form submit', async () => {
    (window as unknown as { jarvis: unknown }).jarvis = {
      invoke: async (method: string) => {
        if (method === 'provider.list') return [];
        if (method === 'provider.create') return { id: 'p1', name: 'My Provider', type: 'openai-compatible', baseUrl: 'https://x.com', apiKeyRef: 'k', createdAt: '', updatedAt: '' };
        return [];
      }
    };
    render(<ProviderSettingsPage />);
    fireEvent.click(screen.getByTestId('provider-add-open'));
    fireEvent.change(screen.getByTestId('provider-name'), { target: { value: 'My Provider' } });
    fireEvent.change(screen.getByTestId('provider-baseurl'), { target: { value: 'https://x.com' } });
    fireEvent.change(screen.getByTestId('provider-apikey'), { target: { value: 'sk-x' } });
    fireEvent.click(screen.getByTestId('provider-save'));
    await waitFor(() => expect(screen.getByText('My Provider')).toBeTruthy());
  });
});
