import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { SearchProvidersPage } from './SearchProvidersPage';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
  (window as unknown as { jarvis: unknown }).jarvis = {
    invoke: async () => [],
    settingsGet: async () => [{ type: 'serper', apiKey: 'k', enabled: true }],
    settingsSet: async () => {},
    onDidReceive: () => () => {}
  };
});

afterEach(() => { cleanup(); });

describe('SearchProvidersPage', () => {
  it('renders a row per provider type and loads saved configs', async () => {
    render(<SearchProvidersPage />);
    await waitFor(() => expect(screen.getByTestId('search-provider-bing')).toBeTruthy());
    expect(screen.getByTestId('search-provider-brave')).toBeTruthy();
    expect(screen.getByTestId('search-provider-tavily')).toBeTruthy();
    expect(screen.getByTestId('search-provider-serper')).toBeTruthy();
    // Loaded serper config reflects its saved apiKey + enabled state.
    const serperKey = screen.getByTestId('search-provider-key-serper') as HTMLInputElement;
    const serperEnabled = screen.getByTestId('search-provider-enabled-serper') as HTMLInputElement;
    expect(serperKey.value).toBe('k');
    expect(serperEnabled.checked).toBe(true);
  });

  it('persists edits to settings.search_providers on save', async () => {
    const settingsSet = vi.fn(async () => {});
    (window as unknown as { jarvis: { settingsSet: (k: string, v: unknown) => Promise<void> } }).jarvis.settingsSet = settingsSet;
    try {
      render(<SearchProvidersPage />);
      await waitFor(() => expect(screen.getByTestId('search-provider-brave')).toBeTruthy());
      fireEvent.change(screen.getByTestId('search-provider-key-brave'), { target: { value: 'b-key' } });
      fireEvent.click(screen.getByTestId('search-provider-enabled-brave'));
      fireEvent.click(screen.getByTestId('search-providers-save'));
      await waitFor(() => expect(settingsSet).toHaveBeenCalledTimes(1));
      const saved = (settingsSet.mock.calls as unknown as Array<[string, unknown]>)[0][1] as Array<{ type: string; apiKey: string; enabled: boolean }>;
      expect(saved).toContainEqual({ type: 'brave', apiKey: 'b-key', enabled: true });
      // The previously-loaded serper config survives the save round-trip.
      expect(saved).toContainEqual({ type: 'serper', apiKey: 'k', enabled: true });
    } finally {
      (window as unknown as { jarvis: { settingsSet: (k: string, v: unknown) => Promise<void> } }).jarvis.settingsSet = async () => {};
    }
  });

  it('surfaces a settingsSet rejection as an inline error', async () => {
    (window as unknown as { jarvis: { settingsSet: (k: string, v: unknown) => Promise<void> } }).jarvis.settingsSet = async () => { throw new Error('boom'); };
    try {
      render(<SearchProvidersPage />);
      await waitFor(() => expect(screen.getByTestId('search-providers-save')).toBeTruthy());
      fireEvent.click(screen.getByTestId('search-providers-save'));
      await waitFor(() => expect(screen.getByTestId('search-providers-error').textContent).toBe('boom'));
    } finally {
      (window as unknown as { jarvis: { settingsSet: (k: string, v: unknown) => Promise<void> } }).jarvis.settingsSet = async () => {};
    }
  });
});
