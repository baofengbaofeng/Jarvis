import { afterEach, describe, it, expect, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { McpSettingsPage } from './McpSettingsPage';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
  (window as unknown as { jarvis: unknown }).jarvis = {
    invoke: async (m: string) => {
      if (m === 'mcp.list') return [{ id: 's1', name: 'fs', transport: 'stdio', config: { command: 'npx', args: [], agentIds: ['a1'] } }];
      if (m === 'agent.list') return [{ id: 'a1', name: 'Agent 1' }, { id: 'a2', name: 'Agent 2' }];
      if (m === 'mcp.test') return { ok: true, tools: ['read', 'write'] };
      return { ok: true };
    },
    onDidReceive: () => () => {}
  };
});

afterEach(cleanup);

describe('McpSettingsPage', () => {
  it('renders form with args + agent binding and adds a server', async () => {
    render(<McpSettingsPage />);
    await waitFor(() => expect(screen.getByTestId('mcp-add')).toBeTruthy());
    fireEvent.change(screen.getByTestId('mcp-name'), { target: { value: 'fs' } });
    fireEvent.change(screen.getByTestId('mcp-command'), { target: { value: 'npx' } });
    fireEvent.change(screen.getByTestId('mcp-args'), { target: { value: '-y @modelcontextprotocol/server-filesystem' } });
    fireEvent.click(screen.getByTestId('mcp-add'));
  });

  it('lists bound agents and runs the Test button', async () => {
    render(<McpSettingsPage />);
    await waitFor(() => expect(screen.getByTestId('mcp-test-s1')).toBeTruthy());
    // Per-agent binding options come from agent.list.
    expect(screen.getByText('Agent 1')).toBeTruthy();
    expect(screen.getByText('Agent 2')).toBeTruthy();
    fireEvent.click(screen.getByTestId('mcp-test-s1'));
    await waitFor(() => expect(screen.getByTestId('mcp-test-result-s1').textContent).toContain('2'));
  });
});
