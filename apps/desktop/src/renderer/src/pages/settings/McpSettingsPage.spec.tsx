import { afterEach, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { McpSettingsPage } from './McpSettingsPage';
import { expectInvoke, installMockJarvis } from '../../test/mockJarvis';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    resources: getResources(),
    lng: 'zh-CN',
    ns: ['common'],
    defaultNS: 'common',
  });
});

afterEach(cleanup);

describe('McpSettingsPage', () => {
  beforeEach(() => {
    installMockJarvis({
      invoke: async (m, payload) => {
        if (m === 'mcp.list') {
          return [{ id: 's1', name: 'fs', transport: 'stdio', config: { command: 'npx', args: [], agentIds: ['a1'] } }];
        }
        if (m === 'agent.list') return [{ id: 'a1', name: 'Agent 1' }, { id: 'a2', name: 'Agent 2' }];
        if (m === 'mcp.test') {
          expect(payload).toEqual({ id: 's1' });
          return { ok: true, tools: ['read', 'write'] };
        }
        if (m === 'mcp.create') return { ok: true };
        return { ok: true };
      },
    });
  });

  it('renders form with args + agent binding and adds a server', async () => {
    render(<McpSettingsPage />);
    await waitFor(() => expect(screen.getByTestId('mcp-add')).toBeTruthy());
    fireEvent.change(screen.getByTestId('mcp-name'), { target: { value: 'fs' } });
    fireEvent.change(screen.getByTestId('mcp-command'), { target: { value: 'npx' } });
    fireEvent.change(screen.getByTestId('mcp-args'), { target: { value: '-y @modelcontextprotocol/server-filesystem' } });
    fireEvent.click(screen.getByTestId('mcp-add'));
  });

  it('submits mcp.create with transport, args, and selected agentIds', async () => {
    const jarvis = installMockJarvis({
      invoke: async (m) => {
        if (m === 'mcp.list') return [];
        if (m === 'agent.list') return [{ id: 'a1', name: 'Agent 1' }, { id: 'a2', name: 'Agent 2' }];
        if (m === 'mcp.create') return { id: 'new', name: 'my-mcp', transport: 'stdio', config: {} };
        return { ok: true };
      },
    });
    render(<McpSettingsPage />);
    await waitFor(() => expect(screen.getByText('Agent 2')).toBeTruthy());

    fireEvent.change(screen.getByTestId('mcp-name'), { target: { value: 'my-mcp' } });
    fireEvent.change(screen.getByTestId('mcp-command'), { target: { value: 'npx' } });
    fireEvent.change(screen.getByTestId('mcp-args'), { target: { value: '-y pkg' } });
    fireEvent.click(screen.getByLabelText('Agent 2'));
    fireEvent.click(screen.getByTestId('mcp-add'));

    await waitFor(() => {
      expectInvoke(jarvis.invoke, 'mcp.create', (payload) => {
        expect(payload).toEqual({
          name: 'my-mcp',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', 'pkg'],
          agentIds: ['a2'],
        });
        return true;
      });
    });
  });

  it('lists bound agents and runs the Test button', async () => {
    render(<McpSettingsPage />);
    await waitFor(() => expect(screen.getByTestId('mcp-test-s1')).toBeTruthy());
    expect(screen.getByText('Agent 1')).toBeTruthy();
    expect(screen.getByText('Agent 2')).toBeTruthy();
    fireEvent.click(screen.getByTestId('mcp-test-s1'));
    await waitFor(() => expect(screen.getByTestId('mcp-test-result-s1').textContent).toContain('2'));
  });

  it('echoes persisted transport in the server list', async () => {
    render(<McpSettingsPage />);
    await waitFor(() => expect(screen.getByTestId('mcp-server-s1')).toBeTruthy());
    expect(screen.getByTestId('mcp-server-s1').textContent).toContain('stdio');
  });
});
