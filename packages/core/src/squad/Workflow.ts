export interface AgentNode { id: string; agentId: string; input: string }
export interface Edge { from: string; to: string }
export interface Workflow { nodes: AgentNode[]; edges: Edge[] }
export class DagError extends Error {}

export function topoSort(wf: Workflow): string[] {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of wf.nodes) { indeg.set(n.id, 0); adj.set(n.id, []); }
  for (const e of wf.edges) {
    if (!indeg.has(e.from) || !indeg.has(e.to)) throw new DagError(`edge references unknown node: ${e.from}->${e.to}`);
    indeg.set(e.to, indeg.get(e.to)! + 1);
    adj.get(e.from)!.push(e.to);
  }
  const q = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const order: string[] = [];
  while (q.length) {
    const cur = q.shift()!;
    order.push(cur);
    for (const nx of adj.get(cur) ?? []) {
      indeg.set(nx, indeg.get(nx)! - 1);
      if (indeg.get(nx) === 0) q.push(nx);
    }
  }
  if (order.length !== wf.nodes.length) throw new DagError('workflow contains a cycle');
  return order;
}

export async function runWorkflow(wf: Workflow, runNode: (node: AgentNode, context: string) => Promise<string>): Promise<Record<string, string>> {
  const order = topoSort(wf);
  const outputs: Record<string, string> = {};
  for (const id of order) {
    const node = wf.nodes.find(n => n.id === id)!;
    const upstream = wf.edges.filter(e => e.to === id).map(e => `[${e.from} 输出]\n${outputs[e.from] ?? ''}`).join('\n');
    outputs[id] = await runNode(node, upstream ? `${node.input}\n${upstream}` : node.input);
  }
  return outputs;
}
