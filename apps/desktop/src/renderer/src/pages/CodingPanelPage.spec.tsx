import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { CodingPanelPage } from './CodingPanelPage';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
  (window as unknown as { jarvis: unknown }).jarvis = {
    invoke: async (m: string) => m === 'workspace.tree' ? [{ name: 'src', path: 'src', type: 'dir', children: [{ name: 'a.ts', path: 'src/a.ts', type: 'file', children: [] }] }] : { ok: false, error: 'x' },
    onDidReceive: () => () => {}
  };
});

describe('CodingPanelPage', () => {
  it('renders file tree', async () => {
    render(<CodingPanelPage />);
    await waitFor(() => expect(screen.getByTestId('file-tree')).toBeTruthy());
    expect(screen.getByTestId('tree-file').textContent).toBe('a.ts');
  });
});
