import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { ProviderSettingsPage } from './ProviderSettingsPage';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

afterEach(() => {
  cleanup();
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

  it('lists models for a provider and adds a model', async () => {
    const added: Array<{ args: unknown[] }> = [];
    (window as unknown as { jarvis: unknown }).jarvis = {
      invoke: async (method: string, ...args: unknown[]) => {
        if (method === 'provider.list') {
          return [{ id: 'p1', name: 'My Provider', type: 'openai-compatible', baseUrl: 'https://x.com', apiKeyRef: 'k', createdAt: '', updatedAt: '' }];
        }
        if (method === 'provider.listModels') {
          if (args[0] !== 'p1') return [];
          const models = [{ id: 'm1', providerId: 'p1', modelId: 'gpt-x', name: 'Model X', createdAt: '' }];
          if (added.length > 0) models.push({ id: 'm2', providerId: 'p1', modelId: 'gpt-y', name: 'Model Y', createdAt: '' });
          return models;
        }
        if (method === 'provider.addModel') {
          added.push({ args });
          return { id: 'm2', providerId: 'p1', modelId: (args[1] as { modelId: string }).modelId, name: (args[1] as { name: string }).name, createdAt: '' };
        }
        return [];
      }
    };

    render(<ProviderSettingsPage />);
    await waitFor(() => expect(screen.getByText(/Model X/)).toBeTruthy());

    fireEvent.change(screen.getByTestId('provider-model-id'), { target: { value: 'gpt-y' } });
    fireEvent.change(screen.getByTestId('provider-model-name'), { target: { value: 'Model Y' } });
    fireEvent.click(screen.getByTestId('provider-model-add'));

    await waitFor(() => expect(screen.getByText(/Model Y/)).toBeTruthy());
    expect(added).toEqual([{ args: ['p1', { modelId: 'gpt-y', name: 'Model Y' }] }]);
  });
});
