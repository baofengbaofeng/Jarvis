import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { AgentDetailPage } from './AgentDetailPage';
import { useAgentStore } from '../stores/agent-store';

const invoke = vi.fn(async (m: string, ..._args: unknown[]) => {
  if (m === 'dialog.pickPath') return [{ token: 'cap-ws', name: 'my-project', kind: 'directory', sizeBytes: 0, expiresAt: 1 }];
  if (m === 'provider.listSelectableModels') {
    return [{ id: 'm1', providerId: 'p1', providerName: 'P', modelId: 'gpt-x', name: 'Model X', contextTokens: null }];
  }
  if (m === 'mcp.list') return [{ id: 'srv1', name: 'fs', enabled: true }, { id: 'srv2', name: 'web', enabled: true }];
  if (m === 'agent.create') return { id: 'new-agent', name: 'Test', slug: 'test', description: '', systemPrompt: '', modelId: null, workspaceId: null, contextBudgetTokens: 1000, planOnly: false, mcpServerIds: ['srv1'], createdAt: '', updatedAt: '' };
  if (m === 'workspace.bind') return { ok: true };
  return undefined;
});

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

beforeEach(() => {
  useAgentStore.setState({ agents: [], current: null });
  (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
  invoke.mockClear();
});

afterEach(cleanup);

describe('AgentDetailPage', () => {
  it('binds workspace after create when picker ran before save', async () => {
    render(<AgentDetailPage agentId={null} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('agent-bind-workspace'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('dialog.pickPath', { purpose: 'workspace-bind' }));
    expect(invoke).not.toHaveBeenCalledWith('workspace.bind', expect.anything(), expect.anything());
    fireEvent.change(screen.getByTestId('agent-name'), { target: { value: 'Test' } });
    fireEvent.click(screen.getByTestId('agent-save'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('agent.create', expect.objectContaining({ name: 'Test' })));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('workspace.bind', 'new-agent', { capability: 'cap-ws' }));
  });

  it('creates with selected mcpServerIds', async () => {
    render(<AgentDetailPage agentId={null} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('fs')).toBeTruthy());
    fireEvent.change(screen.getByTestId('agent-name'), { target: { value: 'Test' } });
    fireEvent.click(screen.getByLabelText('fs'));
    fireEvent.click(screen.getByTestId('agent-save'));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('agent.create', expect.objectContaining({
        name: 'Test',
        mcpServerIds: ['srv1'],
      }));
    });
  });
});
