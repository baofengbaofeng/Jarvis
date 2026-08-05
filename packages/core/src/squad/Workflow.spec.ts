import { describe, it, expect } from 'vitest';
import { topoSort, runWorkflow, DagError, type Workflow } from './Workflow';

const wf: Workflow = {
  nodes: [
    { id: 'a', agentId: 'A', input: 'seed' },
    { id: 'b', agentId: 'B', input: '' },
    { id: 'c', agentId: 'C', input: '' }
  ],
  edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'c' }]
};

describe('workflow', () => {
  it('topologically sorts', () => {
    const order = topoSort(wf);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
  });

  it('throws on cycle', () => {
    const cyc: Workflow = { nodes: [{ id: 'x', agentId: 'X', input: '' }, { id: 'y', agentId: 'Y', input: '' }], edges: [{ from: 'x', to: 'y' }, { from: 'y', to: 'x' }] };
    expect(() => topoSort(cyc)).toThrow(DagError);
  });

  it('passes upstream output into downstream input', async () => {
    // NOTE (deviation): the brief's runNode read `n.input`, the node's STATIC
    // input, so it never saw the injected upstream — the assertion could not
    // pass against the brief's own (sound) runWorkflow, which delivers the
    // composed input as the second `context` argument. Consume `context` so the
    // test actually verifies the F10 injection contract.
    const runNode = async (n: { id: string; agentId: string; input: string }, context: string) => `OUT(${n.id})=${context}`;
    const outputs = await runWorkflow(wf, runNode);
    expect(outputs.b).toContain('OUT(a)');  // b 的输出包含 a 的输出注入
    expect(outputs.c).toContain('OUT(a)');
  });
});
