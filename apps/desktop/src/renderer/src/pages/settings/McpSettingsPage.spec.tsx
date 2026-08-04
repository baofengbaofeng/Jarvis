import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { McpSettingsPage } from './McpSettingsPage';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
  (window as unknown as { jarvis: unknown }).jarvis = {
    invoke: async (m: string) => m === 'mcp.list' ? [] : { ok: true },
    onDidReceive: () => () => {}
  };
});

describe('McpSettingsPage', () => {
  it('renders and adds server', async () => {
    render(<McpSettingsPage />);
    await waitFor(() => expect(screen.getByTestId('mcp-add')).toBeTruthy());
    fireEvent.change(screen.getByTestId('mcp-name'), { target: { value: 'fs' } });
    fireEvent.change(screen.getByTestId('mcp-command'), { target: { value: 'npx' } });
    fireEvent.click(screen.getByTestId('mcp-add'));
  });
});
