import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { WritingView } from './WritingView';

// Same i18n bootstrap as the sibling component specs: init i18next with the
// real @jarvis/i18n resources so useTranslation('common') resolves and the
// component emits no NO_I18NEXT_INSTANCE warning under test.
beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

// vitest globals are off here, so @testing-library/react does not auto-cleanup
// between tests; two renders would pile up in the shared jsdom DOM and both
// components would answer the same data-testid query. Unmount after every test.
afterEach(cleanup);

describe('WritingView', () => {
  it('invokes office.writing on action', async () => {
    const invoke = vi.fn(async () => ({ ok: true, result: '润色后' }));
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(<WritingView />);
    fireEvent.change(screen.getByTestId('writing-text'), { target: { value: 'some text' } });
    fireEvent.click(screen.getByTestId('writing-polish'));
    expect(invoke).toHaveBeenCalledWith('office.writing', expect.objectContaining({ action: 'polish' }));
  });

  it('surfaces writing.error when the channel rejects', async () => {
    const invoke = vi.fn(async () => { throw new Error('no agent with a valid model binding'); });
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(<WritingView />);
    fireEvent.change(screen.getByTestId('writing-text'), { target: { value: 'some text' } });
    fireEvent.click(screen.getByTestId('writing-polish'));
    // The error is surfaced via the wired writing.error key, not an unhandled rejection.
    expect(await screen.findByTestId('writing-error')).toBeTruthy();
    expect(screen.getByTestId('writing-error').textContent).toBe('处理失败');
  });
});
