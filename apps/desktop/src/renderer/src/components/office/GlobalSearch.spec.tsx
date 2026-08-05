import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { GlobalSearch } from './GlobalSearch';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

afterEach(() => { cleanup(); });

describe('GlobalSearch', () => {
  it('invokes search.global and groups results by table', async () => {
    const invoke = vi.fn(async () => ({
      ok: true,
      results: [
        { table: 'message', id: '1', title: '', snippet: 'contains jarvis keyword' },
        { table: 'task', id: '7', title: 'jarvis setup', snippet: 'steps' }
      ]
    }));
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(<GlobalSearch />);
    fireEvent.change(screen.getByTestId('global-search-query'), { target: { value: 'jarvis' } });
    fireEvent.click(screen.getByTestId('global-search-run'));
    expect(invoke).toHaveBeenCalledWith('search.global', { query: 'jarvis' });
    expect(await screen.findByTestId('global-search-group-message')).toBeTruthy();
    expect(screen.getByTestId('global-search-group-task')).toBeTruthy();
    expect(screen.queryByTestId('global-search-group-agent')).toBeNull();
  });

  it('shows the empty state when a search returns no results', async () => {
    const invoke = vi.fn(async () => ({ ok: true, results: [] }));
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(<GlobalSearch />);
    fireEvent.change(screen.getByTestId('global-search-query'), { target: { value: 'zzz' } });
    fireEvent.click(screen.getByTestId('global-search-run'));
    expect(await screen.findByTestId('global-search-empty')).toBeTruthy();
  });

  it('surfaces a search.global error inline', async () => {
    const invoke = vi.fn(async () => ({ ok: false, error: 'FTS query error' }));
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(<GlobalSearch />);
    fireEvent.change(screen.getByTestId('global-search-query'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByTestId('global-search-run'));
    expect(await screen.findByTestId('global-search-error')).toBeTruthy();
    expect(screen.getByTestId('global-search-error').textContent).toBe('FTS query error');
  });
});
