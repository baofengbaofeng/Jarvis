import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { DEFAULT_WIPE_TABLES } from '@jarvis/core/renderer';
import { WipePane } from './WipePane';

const invoke = vi.fn(async (m: string) => {
  if (m === 'wipe.run') return { deleted: { chat_messages: 2 }, keychainDeleted: 0, workspaceRemoved: false, vacuumed: true };
  return undefined;
});

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

beforeEach(() => { (window as any).jarvis = { invoke }; });

afterEach(() => { cleanup(); });

describe('WipePane', () => {
  it('defaults to the full L20 table list and keychain scope with DELETE ALL phrase', async () => {
    render(<WipePane />);
    await waitFor(() => expect(screen.getByTestId('wipe-pane')).toBeTruthy());
    const keychain = screen.getByTestId('wipe-keychain') as HTMLInputElement;
    expect(keychain.checked).toBe(true);
    expect((screen.getByTestId('wipe-phrase') as HTMLInputElement).placeholder).toBe('DELETE ALL');
    expect(screen.getByText('同时删除 Keychain 中的 API Key')).toBeTruthy();
  });

  it('calls wipe.run with the scope and typed phrase, then shows the JSON result', async () => {
    render(<WipePane />);
    await waitFor(() => expect(screen.getByTestId('wipe-run')).toBeTruthy());
    fireEvent.change(screen.getByTestId('wipe-phrase'), { target: { value: 'DELETE ALL' } });
    fireEvent.click(screen.getByTestId('wipe-run'));
    await waitFor(() => expect(screen.getByTestId('wipe-msg')).toBeTruthy());
    expect(invoke).toHaveBeenCalledWith('wipe.run', { tables: DEFAULT_WIPE_TABLES, keychain: true, workspace: false }, 'DELETE ALL');
    expect(screen.getByTestId('wipe-msg').textContent).toContain('chat_messages');
  });
});
