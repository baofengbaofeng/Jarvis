import { describe, it, expect } from 'vitest';
import { CallGraph, detectCycle, type CallEdge } from './CallGraph';

describe('call graph', () => {
  it('records edges and builds react-flow rows', () => {
    const g = new CallGraph();
    g.addEdge('a', 'b', { taskId: 't1' });
    g.addEdge('b', 'c', { taskId: 't1', ok: false });
    const rows = g.toRows();
    expect(rows).toEqual([
      { from: 'a', to: 'b', label: 'ok' },
      { from: 'b', to: 'c', label: 'failed' }
    ]);
  });

  it('detects a repeated delegation as a cycle', () => {
    const g = new CallGraph();
    g.addEdge('a', 'b', { taskId: 't1' });
    g.addEdge('a', 'b', { taskId: 't1' });
    expect(detectCycle(g.getEdges())).toBe(true);
    expect(detectCycle([{ id: '1', from: 'a', to: 'b', ok: true, ts: 1 }] as CallEdge[])).toBe(false);
  });
});
