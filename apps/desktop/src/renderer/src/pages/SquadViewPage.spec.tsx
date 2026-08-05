import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
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
});
