import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IpcChannel } from '@jarvis/protocol';
import { useAgentStore } from './agent-store';

const agent = {
  id: 'a1',
  name: 'Agent',
  slug: 'agent',
  description: '',
  systemPrompt: 'hi',
  modelId: 'm1',
  workspaceId: null,
  contextBudgetTokens: 1000,
  planOnly: false,
  createdAt: '',
  updatedAt: ''
};

describe('agent-store', () => {
  const invoke = vi.fn();

  beforeEach(() => {
    invoke.mockReset();
    useAgentStore.setState({ agents: [], current: null });
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
  });

  it('refresh loads agents and keeps current when still present', async () => {
    useAgentStore.setState({ current: agent });
    invoke.mockResolvedValueOnce([agent]);
    await useAgentStore.getState().refresh();
    expect(invoke).toHaveBeenCalledWith(IpcChannel.agentList);
    expect(useAgentStore.getState().current?.id).toBe('a1');
    expect(useAgentStore.getState().agents).toHaveLength(1);
  });

  it('refresh clears current when agent was deleted', async () => {
    useAgentStore.setState({ current: agent });
    invoke.mockResolvedValueOnce([]);
    await useAgentStore.getState().refresh();
    expect(useAgentStore.getState().current).toBeNull();
  });

  it('create appends agent and sets current when unset', async () => {
    invoke.mockResolvedValueOnce(agent);
    const created = await useAgentStore.getState().create({
      name: 'Agent',
      systemPrompt: 'hi',
      modelId: 'm1',
      workspaceId: null
    });
    expect(invoke).toHaveBeenCalledWith(IpcChannel.agentCreate, expect.any(Object));
    expect(created.id).toBe('a1');
    expect(useAgentStore.getState().current?.id).toBe('a1');
  });

  it('remove invokes agent.delete and refreshes', async () => {
    invoke.mockResolvedValueOnce(undefined).mockResolvedValueOnce([]);
    await useAgentStore.getState().remove('a1');
    expect(invoke).toHaveBeenCalledWith(IpcChannel.agentDelete, 'a1');
    expect(invoke).toHaveBeenCalledWith(IpcChannel.agentList);
  });
});
