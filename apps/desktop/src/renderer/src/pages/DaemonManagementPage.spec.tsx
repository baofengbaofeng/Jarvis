import { afterEach, beforeEach, describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { DaemonManagementPage, type DaemonStatus } from './DaemonManagementPage';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
  (window as unknown as { jarvis: unknown }).jarvis = {
    invoke: async (m: string, args?: unknown) => {
      if (m === 'daemon.status') return statusMock();
      if (m === 'daemon.restart') { restartMock(); return { ok: true }; }
      if (m === 'daemon.injectionApprovals.list') return listApprovalsMock();
      if (m === 'daemon.injectionApprovals.approve') { approveMock(args); return { ok: true }; }
      // M7 Task 10: the page now mounts the Multica runtime surfaces, which poll
      // their own IPC channels. Stub them so the smoke test sees real content.
      if (m === 'runtime.status') return { registered: false, busy: false, activeTasks: 0, lastHeartbeatAt: 0, serverUrl: '', protocol: 'acp', mode: 'local' as const };
      if (m === 'runtime.conflicts') return [];
      return null;
    },
    onDidReceive: () => () => {}
  };
});

const restartMock = vi.fn();
const statusMock = vi.fn<() => Promise<DaemonStatus>>();
const listApprovalsMock = vi.fn<() => Promise<{ ok: true; items: Array<{ kind: string; name: string; digest: string; taskId: string; createdAt: string }> }>>();
const approveMock = vi.fn();

beforeEach(() => {
  restartMock.mockReset();
  statusMock.mockReset();
  listApprovalsMock.mockReset();
  approveMock.mockReset();
  statusMock.mockResolvedValue({ running: true, version: '0.1.1', activeTasks: 2, queued: 1, perAgent: 6, concurrency: 20 });
  listApprovalsMock.mockResolvedValue({ ok: true, items: [] });
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

  it('mounts the Multica runtime status and skills merger surfaces (M7 Task 10)', async () => {
    render(<DaemonManagementPage />);
    // RuntimeStatusView resolves its first poll; SkillsMerger renders once the
    // conflicts fetch returns (empty list -> no-conflicts state).
    await waitFor(() => expect(screen.getByTestId('runtime-status')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('skills-merger')).toBeTruthy());
    expect(screen.getByTestId('no-conflicts')).toBeTruthy();
  });

  it('shows pending injection source/name/digest without secrets or raw args', async () => {
    listApprovalsMock.mockResolvedValue({
      ok: true,
      items: [{ kind: 'mcp', name: 'fs', digest: 'abc123', taskId: 't1', createdAt: '2026-01-01T00:00:00Z' }],
    });
    render(<DaemonManagementPage />);
    await waitFor(() => expect(screen.getByTestId('injection-name').textContent).toContain('fs'));
    expect(screen.getByTestId('injection-digest').textContent).toContain('abc123');
    expect(screen.getByTestId('injection-approvals').textContent).not.toContain('super-secret');
    expect(screen.getByTestId('injection-approvals').textContent).not.toContain('--password');
  });

  it('approve prompts the user to retry the original task', async () => {
    listApprovalsMock.mockResolvedValue({
      ok: true,
      items: [{ kind: 'mcp', name: 'fs', digest: 'abc123', taskId: 't1', createdAt: '2026-01-01T00:00:00Z' }],
    });
    render(<DaemonManagementPage />);
    await waitFor(() => expect(screen.getByTestId('injection-approve-abc123')).toBeTruthy());
    fireEvent.click(screen.getByTestId('injection-approve-abc123'));
    await waitFor(() => expect(approveMock).toHaveBeenCalledWith({ kind: 'mcp', name: 'fs', digest: 'abc123' }));
    await waitFor(() => expect(screen.getByTestId('injection-retry-hint')).toBeTruthy());
  });
});
