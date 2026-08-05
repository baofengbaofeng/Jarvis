import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { PromptTemplatesPage } from './PromptTemplatesPage';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
  (window as unknown as { jarvis: unknown }).jarvis = {
    invoke: async (m: string) => m === 'templates.list'
      ? [{ id: 't1', name: 'review', content: 'Review {{name}}' }]
      : { ok: true, result: 'Review Jarvis' },
    onDidReceive: () => () => {}
  };
});

afterEach(() => {
  cleanup();
});

describe('PromptTemplatesPage', () => {
  it('lists templates and renders preview', async () => {
    render(<PromptTemplatesPage />);
    await waitFor(() => expect(screen.getByTestId('tpl-save')).toBeTruthy());
    fireEvent.click(screen.getByTestId('tpl-render-t1'));
    await waitFor(() => expect(screen.getByTestId('tpl-preview').textContent).toBe('Review Jarvis'));
  });

  it('detects variables in the form body and exposes them', async () => {
    render(<PromptTemplatesPage />);
    await waitFor(() => expect(screen.getByTestId('tpl-text')).toBeTruthy());
    fireEvent.change(screen.getByTestId('tpl-text'), { target: { value: 'Hi {{name}}, task {{ title }}' } });
    expect(screen.getByTestId('tpl-vars').textContent).toContain('name, title');
  });

  it('inserts substituted text via onInsert', async () => {
    const onInsert = vi.fn();
    render(<PromptTemplatesPage onInsert={onInsert} />);
    await waitFor(() => expect(screen.getByTestId('tpl-insert-t1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('tpl-insert-t1'));
    expect(onInsert).toHaveBeenCalledWith('Review Jarvis');
  });
});
