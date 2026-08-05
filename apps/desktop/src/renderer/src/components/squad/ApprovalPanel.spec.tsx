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
  it('renders the in_review squad and approves through squad.approve with a { id, ok } object', async () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    const onDone = vi.fn();
    render(<ApprovalPanel squadId="sq-1" summary="plan A" members={[{ agent: 'a1', result: 'done' }]} onDone={onDone} />);
    expect(screen.getByTestId('approval-panel')).toBeTruthy();
    expect(screen.getByTestId('approval-summary').textContent).toBe('plan A');
    expect(screen.getByTestId('approval-member-a1').textContent).toContain('done');
    fireEvent.click(screen.getByTestId('approval-ok'));
    // The main squad.approve handler destructures a single { id, ok } arg (the
    // preload spreads positional args), so the invoke must carry an object.
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('squad.approve', { id: 'sq-1', ok: true }));
    expect(onDone).toHaveBeenCalled();
  });

  it('rejects through squad.approve with a { id, ok: false } object', async () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(<ApprovalPanel squadId="sq-1" summary="plan" members={[]} onDone={() => {}} />);
    fireEvent.click(screen.getByTestId('approval-no'));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('squad.approve', { id: 'sq-1', ok: false }));
  });

  it('keeps the panel open and surfaces the error when squad.approve returns { ok:false }', async () => {
    const invoke = vi.fn(async () => ({ ok: false, error: 'squad not found' }));
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    const onDone = vi.fn();
    render(<ApprovalPanel squadId="sq-1" summary="plan A" members={[]} onDone={onDone} />);
    fireEvent.click(screen.getByTestId('approval-ok'));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('squad.approve', { id: 'sq-1', ok: true }));
    // onDone must NOT fire on a failed outcome — the squad is still in_review.
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByTestId('approval-panel')).toBeTruthy();
    // The error state updates after the awaited invoke resolves, so find it
    // asynchronously (findByTestId flushes the React update).
    expect((await screen.findByTestId('approval-error')).textContent).toContain('squad not found');
  });

  it('renders a clean pending state (no raw summary) when detail is empty', () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(<ApprovalPanel squadId="sq-1" summary="" members={[]} onDone={() => {}} />);
    expect(screen.getByTestId('approval-panel')).toBeTruthy();
    // Event-driven in_review arrivals have no summary/members; the panel shows
    // the title + buttons but no raw squad UUID.
    expect(screen.queryByTestId('approval-summary')).toBeNull();
    expect(screen.getByTestId('approval-ok')).toBeTruthy();
    expect(screen.getByTestId('approval-no')).toBeTruthy();
  });
});
