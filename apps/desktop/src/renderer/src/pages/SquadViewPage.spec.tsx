import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { SquadViewPage } from './SquadViewPage';
import { clearSquadEvents } from '../stores/squad-store';

// M6 Task 10 (S5): the squad view loads the current squad's FULL state through
// squad.current (id/leader/members/status/summary/members/graphRows) so it can
// drive the ApprovalPanel with the real review detail — the Task 8 gap where
// squad:status events only carried { id, state }. The page polls every 3s; the
// test asserts the in_review squad renders Leader/Members + call graph +
// timeline + ApprovalPanel.
const IN_REVIEW_SQUAD = {
  id: 'sq-1',
  leaderAgentId: 'leader',
  memberAgentIds: ['m1', 'm2'],
  status: 'in_review',
  summary: 'plan A',
  members: [{ agent: 'm1', result: 'done' }],
  graphRows: [{ from: 'leader', to: 'm1', label: 'ok' }]
};

beforeAll(async () => {
  // Same i18n init as sibling specs (ChatPage.spec/ApprovalPanel.spec) so
  // useTranslation resolves squadView.* without noise.
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

afterEach(() => { cleanup(); clearSquadEvents(); });

describe('SquadViewPage', () => {
  it('loads the current squad and shows the ApprovalPanel when in_review', async () => {
    const invoke = vi.fn(async (method: string) => {
      if (method === 'squad.current') return { ok: true, squad: IN_REVIEW_SQUAD };
      if (method === 'squad.approve') return { ok: true };
      return null;
    });
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(<SquadViewPage />);
    await waitFor(() => expect(screen.getByTestId('approval-panel')).toBeTruthy());
    expect(screen.getByTestId('call-graph')).toBeTruthy();
    expect(screen.getByTestId('timeline')).toBeTruthy();
    expect(screen.getByText('plan A')).toBeTruthy();
  });

  it('renders an empty squad-view when no squad is active', async () => {
    const invoke = vi.fn(async () => ({ ok: true, squad: null }));
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(<SquadViewPage />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('squad.current'));
    expect(screen.getByTestId('squad-view')).toBeTruthy();
    expect(screen.queryByTestId('approval-panel')).toBeNull();
    expect(screen.queryByTestId('call-graph')).toBeNull();
  });

  it('surfaces an inline error when squad.current fails', async () => {
    const invoke = vi.fn(async () => ({ ok: false, error: 'squad not found' }));
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(<SquadViewPage />);
    await waitFor(() => expect(screen.getByTestId('squad-view-error')).toBeTruthy());
  });

  // M6 final review (finding 5): the S5 scenario must be launchable from the
  // product. The "New squad" launch control invokes squad.create then
  // squad.start with the selected leader/members/task.
  it('creates and starts a squad through the launch control (S5)', async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const invoke = vi.fn(async (method: string, ...args: unknown[]) => {
      calls.push({ method, args });
      if (method === 'squad.current') return { ok: true, squad: null };
      if (method === 'agent.list') return [
        { id: 'leader', name: 'Leader Agent' },
        { id: 'm1', name: 'M1' },
        { id: 'm2', name: 'M2' }
      ];
      if (method === 'squad.create') return { ok: true, id: 'sq-new' };
      if (method === 'squad.start') return { ok: true, result: { status: 'in_review', summary: 's', members: [] } };
      return null;
    });
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(<SquadViewPage />);
    // Open the form once agents have loaded (leader defaults to the first).
    await waitFor(() => expect(screen.getByTestId('squad-new')).toBeTruthy());
    fireEvent.click(screen.getByTestId('squad-new'));
    await waitFor(() => expect(screen.getByTestId('squad-create-form')).toBeTruthy());
    // Pick m1 as a member (the leader select already defaults to 'leader').
    fireEvent.click(screen.getByTestId('squad-member-m1'));
    fireEvent.change(screen.getByTestId('squad-task-input'), { target: { value: 'do the thing' } });
    fireEvent.click(screen.getByTestId('squad-create-submit'));
    await waitFor(() => {
      const createCall = calls.find(c => c.method === 'squad.create');
      expect(createCall?.args[0]).toEqual({ leaderAgentId: 'leader', memberAgentIds: ['m1'] });
      const startCall = calls.find(c => c.method === 'squad.start');
      expect(startCall?.args[0]).toEqual({ id: 'sq-new', input: 'do the thing' });
    });
  });

  it('surfaces an inline error when squad.create fails', async () => {
    const invoke = vi.fn(async (method: string) => {
      if (method === 'squad.current') return { ok: true, squad: null };
      if (method === 'agent.list') return [{ id: 'leader', name: 'Leader Agent' }];
      if (method === 'squad.create') return { ok: false, error: 'boom' };
      return null;
    });
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(<SquadViewPage />);
    await waitFor(() => expect(screen.getByTestId('squad-new')).toBeTruthy());
    fireEvent.click(screen.getByTestId('squad-new'));
    await waitFor(() => expect(screen.getByTestId('squad-create-form')).toBeTruthy());
    fireEvent.click(screen.getByTestId('squad-create-submit'));
    await waitFor(() => expect(screen.getByTestId('squad-create-error').textContent).toContain('boom'));
    expect(invoke).not.toHaveBeenCalledWith('squad.start');
  });
});
