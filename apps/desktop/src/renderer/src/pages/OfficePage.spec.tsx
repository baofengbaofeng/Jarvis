import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { OfficePage } from './OfficePage';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
  (window as unknown as { jarvis: unknown }).jarvis = {
    invoke: async (m: string) => m === 'templates.list' ? [{ id: 't1', name: 'review', content: 'Review {{name}}' }] : [],
    settingsGet: async () => [],
    settingsSet: async () => {},
    onDidReceive: () => () => {}
  };
});

afterEach(() => { cleanup(); });

describe('OfficePage', () => {
  it('renders the office aggregate with the writing view mounted by default', async () => {
    render(<OfficePage />);
    expect(screen.getByTestId('office-page')).toBeTruthy();
    // Writing tab is the default; SelectionMenu is NOT remounted here.
    expect(screen.getByTestId('writing-view')).toBeTruthy();
    expect(screen.queryByTestId('selection-menu')).toBeNull();
  });

  it('switches to the search-providers tab', async () => {
    render(<OfficePage />);
    fireEvent.click(screen.getByTestId('office-tab-search'));
    await waitFor(() => expect(screen.getByTestId('search-providers')).toBeTruthy());
  });

  it('routes a template insert into the shared composer', async () => {
    render(<OfficePage />);
    fireEvent.click(screen.getByTestId('office-tab-templates'));
    await waitFor(() => expect(screen.getByTestId('tpl-insert-t1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('tpl-insert-t1'));
    // The insert landed in local composer state; switch tabs to read it.
    fireEvent.click(screen.getByTestId('office-tab-composer'));
    await waitFor(() => expect((screen.getByTestId('office-composer') as HTMLTextAreaElement).value).toBe('Review Jarvis'));
  });
});
