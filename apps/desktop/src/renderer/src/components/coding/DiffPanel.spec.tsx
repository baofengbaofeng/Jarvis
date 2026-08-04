import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { DiffPanel } from './DiffPanel';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

describe('DiffPanel', () => {
  it('shows hunks and commits accepts', async () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    render(<DiffPanel taskId="t1" path="a.ts" base={'const x = 1;\n' + 'y'} modified={'const x = 2;\n' + 'y'} />);
    expect(screen.getByTestId('hunk-0')).toBeTruthy();
    fireEvent.click(screen.getByTestId('hunk-0-accept'));
    fireEvent.click(screen.getByTestId('diff-commit'));
    expect(invoke).toHaveBeenCalledWith('diff.applyAll', { taskId: 't1', path: 'a.ts', accepts: [true] });
  });
});
