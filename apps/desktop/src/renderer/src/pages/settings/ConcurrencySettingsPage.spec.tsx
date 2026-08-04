import { afterEach, beforeEach, describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { ConcurrencySettingsPage } from './ConcurrencySettingsPage';

const settingsGetMock = vi.fn<() => Promise<unknown>>();
const settingsSetMock = vi.fn<(...args: unknown[]) => Promise<void>>();
const invokeMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
  settingsGetMock.mockResolvedValue({ perAgent: 4, machine: 10 });
  settingsSetMock.mockResolvedValue(undefined);
  invokeMock.mockResolvedValue({ ok: true });
  (window as unknown as { jarvis: unknown }).jarvis = {
    invoke: invokeMock,
    settingsGet: settingsGetMock,
    settingsSet: settingsSetMock,
    onDidReceive: () => () => {}
  };
});

beforeEach(() => {
  settingsGetMock.mockClear();
  settingsSetMock.mockClear();
  invokeMock.mockClear();
});

afterEach(cleanup);

describe('ConcurrencySettingsPage', () => {
  it('loads the saved concurrency values on mount', async () => {
    render(<ConcurrencySettingsPage />);
    await waitFor(() => expect((screen.getByTestId('concurrency-peragent') as HTMLInputElement).value).toBe('4'));
    expect((screen.getByTestId('concurrency-machine') as HTMLInputElement).value).toBe('10');
    expect(settingsGetMock).toHaveBeenCalledWith('concurrency');
  });

  it('save persists the edited values and restarts the daemon', async () => {
    render(<ConcurrencySettingsPage />);
    await waitFor(() => expect((screen.getByTestId('concurrency-peragent') as HTMLInputElement).value).toBe('4'));
    fireEvent.change(screen.getByTestId('concurrency-peragent'), { target: { value: '8' } });
    fireEvent.change(screen.getByTestId('concurrency-machine'), { target: { value: '12' } });
    fireEvent.click(screen.getByTestId('concurrency-save'));
    await waitFor(() => expect(settingsSetMock).toHaveBeenCalledWith('concurrency', { perAgent: 8, machine: 12 }));
    expect(invokeMock).toHaveBeenCalledWith('daemon.restart');
  });
});
