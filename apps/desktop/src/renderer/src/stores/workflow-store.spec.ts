import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { toWorkflow } from './workflow-store';

describe('toWorkflow (F10)', () => {
  it('serializes ui nodes and edges into M6-compatible Workflow JSON', () => {
    const wf = toWorkflow(
      [{ id: 'a', agentId: 'x', input: 'summarize' }, { id: 'b', agentId: 'y', input: '' }],
      [{ id: 'e1', from: 'a', to: 'b' }],
    );
    expect(wf.nodes[0]).toEqual({ id: 'a', agentId: 'x', input: 'summarize' });
    // M6 Edge is { from; to } (NO id) — the UI edge id must be stripped.
    expect(wf.edges).toEqual([{ from: 'a', to: 'b' }]);
  });
  it('throws when edge references missing node', () => {
    expect(() => toWorkflow([{ id: 'a', agentId: 'x', input: '' }], [{ id: 'e', from: 'a', to: 'nope' }])).toThrow('missing node');
  });
});

describe('workflow store (F10)', () => {
  let invoke: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    invoke = vi.fn(async (channel: string) => {
      if (channel === 'agent.list') return [{ id: 'a1', name: 'Coder' }, { id: 'a2', name: 'Reviewer' }];
      if (channel === 'workflow.run') return { ok: true, outputs: { n1: 'summary text' } };
      return undefined;
    });
    vi.stubGlobal('window', { jarvis: { invoke } });
    // Fresh store state per test (module is singleton).
    const { useWorkflowStore } = await import('./workflow-store');
    useWorkflowStore.setState({ nodes: [], edges: [], agents: [], outputs: null });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('loads agents from the agent.list IPC', async () => {
    const { useWorkflowStore } = await import('./workflow-store');
    await useWorkflowStore.getState().loadAgents();
    expect(invoke).toHaveBeenCalledWith('agent.list');
    expect(useWorkflowStore.getState().agents.map(a => a.name)).toEqual(['Coder', 'Reviewer']);
  });

  it('adds/connects/edits/removes nodes and edges', async () => {
    const { useWorkflowStore } = await import('./workflow-store');
    const s = useWorkflowStore.getState();
    s.addNode('a1');
    const n1 = useWorkflowStore.getState().nodes[0];
    expect(n1.agentId).toBe('a1');
    s.addNode('a2');
    const n2 = useWorkflowStore.getState().nodes[1];
    s.setInput(n1.id, 'summarize');
    expect(useWorkflowStore.getState().nodes.find(n => n.id === n1.id)?.input).toBe('summarize');
    s.connect(n1.id, n2.id);
    expect(useWorkflowStore.getState().edges).toEqual([{ id: expect.any(String), from: n1.id, to: n2.id }]);
    s.removeNode(n1.id);
    expect(useWorkflowStore.getState().nodes.map(n => n.id)).toEqual([n2.id]);
    expect(useWorkflowStore.getState().edges).toEqual([]);
  });

  it('calls workflow.run with a positional JSON string and unwraps { ok, outputs }', async () => {
    const { useWorkflowStore } = await import('./workflow-store');
    useWorkflowStore.setState({
      nodes: [{ id: 'n1', agentId: 'a1', input: 'summarize' }],
      edges: [],
    });
    await useWorkflowStore.getState().run();
    const expectedWf = { nodes: [{ id: 'n1', agentId: 'a1', input: 'summarize' }], edges: [] };
    expect(invoke).toHaveBeenCalledWith('workflow.run', JSON.stringify(expectedWf));
    expect(useWorkflowStore.getState().outputs).toEqual({ n1: 'summary text' });
  });

  it('clears outputs on a { ok: false } workflow.run result', async () => {
    invoke.mockResolvedValueOnce({ ok: false, error: 'another squad run is in progress' });
    const { useWorkflowStore } = await import('./workflow-store');
    useWorkflowStore.setState({ nodes: [{ id: 'n1', agentId: 'a1', input: '' }], edges: [], outputs: { n1: 'stale' } });
    await useWorkflowStore.getState().run();
    expect(useWorkflowStore.getState().outputs).toBeNull();
  });

  it('does not reject when workflow.run invoke throws', async () => {
    invoke.mockRejectedValueOnce(new Error('bridge down'));
    const { useWorkflowStore } = await import('./workflow-store');
    useWorkflowStore.setState({ nodes: [{ id: 'n1', agentId: 'a1', input: '' }], edges: [] });
    await expect(useWorkflowStore.getState().run()).resolves.toBeUndefined();
    expect(useWorkflowStore.getState().outputs).toBeNull();
  });
});
