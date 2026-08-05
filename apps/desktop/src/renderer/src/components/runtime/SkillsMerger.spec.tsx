import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18n from 'i18next';
import { getResources } from '@jarvis/i18n';
import { SkillsMerger } from './SkillsMerger';

describe('SkillsMerger (L38)', () => {
  const invoke = vi.fn(async (ch: string) => {
    if (ch === 'runtime.conflicts') {
      return [{ taskId: 't1', skill: { name: 'review', localPath: '/l', multicaPath: '/m' }, resolved: false }];
    }
    return { ok: true };
  });
  beforeAll(async () => {
    // The resolve button is matched by its translated text ('本地'); init the
    // real zh-CN bundle so runtime.skillsMerger.local resolves to 本地.
    await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
  });
  beforeEach(() => {
    invoke.mockClear();
    // Assign jarvis on the real jsdom window (not stubGlobal) so that
    // window.document stays intact for @testing-library/dom's waitFor.
    (window as unknown as { jarvis: unknown }).jarvis = { invoke };
  });
  it('shows a conflict and resolves via IPC', async () => {
    render(<I18nextProvider i18n={i18n}><SkillsMerger /></I18nextProvider>);
    expect(await screen.findByTestId('conflict-item')).toBeTruthy();
    fireEvent.click(screen.getAllByText('本地')[0]);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('runtime.resolveConflict', { name: 'review', decision: 'local' }));
  });
});
