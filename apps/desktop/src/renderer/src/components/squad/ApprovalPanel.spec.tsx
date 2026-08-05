import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { ApprovalPanel } from './ApprovalPanel';

beforeAll(async () => {
  // Same i18n init as sibling specs (ApprovalModal.spec/DiffPanel.spec) so
  // useTranslation resolves the approval.* keys without noise.
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

afterEach(() => { cleanup(); });

describe('ApprovalPanel', () => {
  it('renders the in_review squad and approves through squad.approve', async () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    const onDone = vi.fn();
    render(<ApprovalPanel squadId="sq-1" summary="plan A" members={[{ agent: 'a1', result: 'done' }]} onDone={onDone} />);
    expect(screen.getByTestId('approval-panel')).toBeTruthy();
    expect(screen.getByTestId('approval-summary').textContent).toBe('plan A');
    expect(screen.getByTestId('approval-member-a1').textContent).toContain('done');
    fireEvent.click(screen.getByTestId('approval-ok'));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('squad.approve', 'sq-1', true));
    expect(onDone).toHaveBeenCalled();
  });

  it('rejects through squad.approve with false', async () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(<ApprovalPanel squadId="sq-1" summary="plan" members={[]} onDone={() => {}} />);
    fireEvent.click(screen.getByTestId('approval-no'));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('squad.approve', 'sq-1', false));
  });
});
