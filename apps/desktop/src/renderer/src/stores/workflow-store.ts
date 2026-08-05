import { create } from 'zustand';
import type { Workflow } from '@jarvis/core/renderer';

// F10 (M8 Task 9): lightweight DAG workflow editor store. The UI keeps a
// UI-only edge `id` (for React keys) on WfUiEdge; toWorkflow strips it because
// the M6 engine's Edge type is { from; to } with NO id field.
export interface WfUiNode { id: string; agentId: string; input: string }
export interface WfUiEdge { id: string; from: string; to: string }

export function toWorkflow(nodes: WfUiNode[], edges: WfUiEdge[]): Workflow {
  const ids = new Set(nodes.map(n => n.id));
  for (const e of edges) if (!ids.has(e.from) || !ids.has(e.to)) throw new Error('missing node ' + (ids.has(e.from) ? e.to : e.from));
  return { nodes, edges: edges.map(({ from, to }) => ({ from, to })) };
}

let seq = 0;
const nextId = (p: string) => `${p}-${Date.now()}-${seq++}`;

export const useWorkflowStore = create<{
  nodes: WfUiNode[]; edges: WfUiEdge[]; agents: Array<{ id: string; name: string }>;
  outputs: Record<string, string> | null;
  loadAgents: () => Promise<void>;
  addNode: (agentId: string) => void;
  removeNode: (id: string) => void;
  connect: (from: string, to: string) => void;
  setInput: (id: string, input: string) => void;
  run: () => Promise<void>;
}>((set, get) => ({
  nodes: [], edges: [], agents: [], outputs: null,
  loadAgents: async () => {
    try {
      const list = (await window.jarvis.invoke('agent.list')) as Array<{ id: string; name: string }> | null;
      set({ agents: Array.isArray(list) ? list : [] });
    } catch (e) {
      set({ agents: [] });
    }
  },
  addNode: (agentId) => set(s => ({ nodes: [...s.nodes, { id: nextId('n'), agentId, input: '' }] })),
  removeNode: (id) => set(s => ({ nodes: s.nodes.filter(n => n.id !== id), edges: s.edges.filter(e => e.from !== id && e.to !== id) })),
  connect: (from, to) => set(s => ({ edges: [...s.edges, { id: nextId('e'), from, to }] })),
  setInput: (id, input) => set(s => ({ nodes: s.nodes.map(n => n.id === id ? { ...n, input } : n) })),
  run: async () => {
    try {
      const wf = toWorkflow(get().nodes, get().edges);
      // workflow.run takes the serialized Workflow as a POSITIONAL string arg
      // and returns { ok, outputs?, error? } (M6 squad.ts handler).
      const r = (await window.jarvis.invoke('workflow.run', JSON.stringify(wf))) as { ok: boolean; outputs?: Record<string, string>; error?: string };
      set({ outputs: r.ok ? (r.outputs ?? null) : null });
    } catch (e) {
      // Bridge failure must not surface as an unhandled rejection.
      set({ outputs: null });
    }
  },
}));
