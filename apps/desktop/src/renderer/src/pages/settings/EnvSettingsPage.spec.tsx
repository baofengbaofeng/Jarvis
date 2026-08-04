import { afterEach, beforeEach, describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { EnvSettingsPage } from './EnvSettingsPage';

const invokeMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
  invokeMock.mockImplementation(async (m: unknown) => {
    if (m === 'agent.list') {
      return [{ id: 'a1', name: 'Agent 1', envVars: { FOO: 'bar', BAZ: 'qux' }, cliArgs: ['--verbose', 'run'] }];
    }
    return { ok: true };
  });
  (window as unknown as { jarvis: unknown }).jarvis = {
    invoke: invokeMock,
    onDidReceive: () => () => {}
  };
});

beforeEach(() => { invokeMock.mockClear(); });
afterEach(cleanup);

describe('EnvSettingsPage', () => {
  it('pre-loads saved env vars and CLI args when an agent is selected', async () => {
    render(<EnvSettingsPage />);
    await waitFor(() => expect(screen.getByTestId('env-agent')).toBeTruthy());
    fireEvent.change(screen.getByTestId('env-agent'), { target: { value: 'a1' } });
    await waitFor(() => expect((screen.getByTestId('env-text') as HTMLTextAreaElement).value).toBe('FOO=bar\nBAZ=qux'));
    expect((screen.getByTestId('env-cli') as HTMLTextAreaElement).value).toBe('--verbose run');
  });

  it('saving without touching the pre-loaded form persists the same values (no wipe)', async () => {
    render(<EnvSettingsPage />);
    await waitFor(() => expect(screen.getByTestId('env-agent')).toBeTruthy());
    fireEvent.change(screen.getByTestId('env-agent'), { target: { value: 'a1' } });
    await waitFor(() => expect((screen.getByTestId('env-text') as HTMLTextAreaElement).value).toBe('FOO=bar\nBAZ=qux'));
    fireEvent.click(screen.getByTestId('env-save'));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('agent.update', 'a1', { envVars: { FOO: 'bar', BAZ: 'qux' }, cliArgs: ['--verbose', 'run'] }));
  });
});
