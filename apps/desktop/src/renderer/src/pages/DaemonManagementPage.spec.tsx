import { afterEach, beforeEach, describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { DaemonManagementPage, type DaemonStatus } from './DaemonManagementPage';

const restartMock = vi.fn();
const statusMock = vi.fn<() => Promise<DaemonStatus>>();

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
  (window as unknown as { jarvis: unknown }).jarvis = {
    invoke: async (m: string) => {
      if (m === 'daemon.status') return statusMock();
      if (m === 'daemon.restart') { restartMock(); return { ok: true }; }
      return null;
    },
    onDidReceive: () => () => {}
  };
});

beforeEach(() => {
  restartMock.mockReset();
  statusMock.mockReset();
  statusMock.mockResolvedValue({ running: true, version: '0.1.1', activeTasks: 2, queued: 1, perAgent: 6, concurrency: 20 });
});

afterEach(cleanup);

describe('DaemonManagementPage', () => {
  it('renders running indicator, version, task counts and restart button', async () => {
    render(<DaemonManagementPage />);
    await waitFor(() => expect(screen.getByTestId('daemon-running').textContent).toContain('●'));
    expect(screen.getByTestId('daemon-version').textContent).toContain('0.1.1');
    expect(screen.getByTestId('daemon-tasks').textContent).toContain('2');
    expect(screen.getByTestId('daemon-tasks').textContent).toContain('1');
    expect(screen.getByTestId('daemon-restart')).toBeTruthy();
  });

  it('restart button invokes daemon.restart', async () => {
    render(<DaemonManagementPage />);
    await waitFor(() => expect(screen.getByTestId('daemon-restart')).toBeTruthy());
    fireEvent.click(screen.getByTestId('daemon-restart'));
    await waitFor(() => expect(restartMock).toHaveBeenCalled());
  });
});
