import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { SearchProvidersPage } from './SearchProvidersPage';

const loadedConfigs = [{ type: 'serper' as const, enabled: true, hasKey: true }];

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
  (window as unknown as { jarvis: unknown }).jarvis = {
    invoke: async (channel: string) => {
      if (channel === 'search.providers.get') return { ok: true, configs: loadedConfigs };
      if (channel === 'search.providers.set') return { ok: true, configs: loadedConfigs };
      return { ok: false, error: 'unknown channel' };
    },
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
    const serperKey = screen.getByTestId('search-provider-key-serper') as HTMLInputElement;
    const serperEnabled = screen.getByTestId('search-provider-enabled-serper') as HTMLInputElement;
    expect(serperKey.value).toBe('');
    expect(serperKey.placeholder).toBe('••••••••');
    expect(serperEnabled.checked).toBe(true);
  });

  it('persists edits to search.providers.set on save', async () => {
    const invoke = vi.fn(async (channel: string, ..._args: unknown[]) => {
      if (channel === 'search.providers.get') return { ok: true, configs: loadedConfigs };
      if (channel === 'search.providers.set') return { ok: true, configs: loadedConfigs };
      return { ok: false };
    });
    (window as unknown as { jarvis: { invoke: typeof invoke; onDidReceive: () => () => void } }).jarvis.invoke = invoke;
    try {
      render(<SearchProvidersPage />);
      await waitFor(() => expect(screen.getByTestId('search-provider-brave')).toBeTruthy());
      fireEvent.change(screen.getByTestId('search-provider-key-brave'), { target: { value: 'b-key' } });
      fireEvent.click(screen.getByTestId('search-provider-enabled-brave'));
      fireEvent.click(screen.getByTestId('search-providers-save'));
      await waitFor(() => expect(invoke).toHaveBeenCalledWith('search.providers.set', expect.any(Array)));
      const saved = (invoke.mock.calls.find(c => c[0] === 'search.providers.set')?.[1] ?? []) as Array<{ type: string; apiKey?: string; enabled: boolean }>;
      expect(saved).toContainEqual({ type: 'brave', apiKey: 'b-key', enabled: true });
      expect(saved.find(c => c.type === 'serper')).toEqual({ type: 'serper', enabled: true });
    } finally {
      (window as unknown as { jarvis: { invoke: (c: string) => Promise<unknown>; onDidReceive: () => () => void } }).jarvis.invoke = async (channel: string) => {
        if (channel === 'search.providers.get') return { ok: true, configs: loadedConfigs };
        return { ok: true };
      };
    }
  });

  it('surfaces a search.providers.set rejection as an inline error', async () => {
    (window as unknown as { jarvis: { invoke: (c: string) => Promise<unknown>; onDidReceive: () => () => void } }).jarvis.invoke = async (channel: string) => {
      if (channel === 'search.providers.get') return { ok: true, configs: loadedConfigs };
      if (channel === 'search.providers.set') return { ok: false, error: 'boom' };
      return { ok: false };
    };
    try {
      render(<SearchProvidersPage />);
      await waitFor(() => expect(screen.getByTestId('search-providers-save')).toBeTruthy());
      fireEvent.click(screen.getByTestId('search-providers-save'));
      await waitFor(() => expect(screen.getByTestId('search-providers-error').textContent).toBe('boom'));
    } finally {
      (window as unknown as { jarvis: { invoke: (c: string) => Promise<unknown>; onDidReceive: () => () => void } }).jarvis.invoke = async (channel: string) => {
        if (channel === 'search.providers.get') return { ok: true, configs: loadedConfigs };
        return { ok: true };
      };
    }
  });
});
