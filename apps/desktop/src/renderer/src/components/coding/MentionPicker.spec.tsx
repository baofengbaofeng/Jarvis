import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { MentionPicker } from './MentionPicker';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

describe('MentionPicker', () => {
  it('searches and selects a candidate', async () => {
    (window as unknown as { jarvis: unknown }).jarvis = {
      invoke: async (m: string, _q: string) => m === 'mention.search' ? [{ id: '1', label: 'src/a.ts', kind: 'file', path: 'src/a.ts' }] : [],
      onDidReceive: () => () => {}
    };
    const onSelect = vi.fn();
    render(<MentionPicker onSelect={onSelect} onClose={() => {}} />);
    fireEvent.change(screen.getByTestId('mention-input'), { target: { value: 'a.t' } });
    await waitFor(() => expect(screen.getByTestId('mention-option')).toBeTruthy());
    fireEvent.click(screen.getByTestId('mention-option'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ path: 'src/a.ts' }));
  });
});
