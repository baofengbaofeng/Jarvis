import type { IndexStore, MentionCandidate } from '@jarvis/core';

// M4 Task 8 (E6): main-side mention.search. The renderer's MentionPicker calls
// `mention.search` with just the query string; this handler needs the code
// index, the agent list, and a workspace-tree fn — all bound in IpcRouter
// (controller gap #4) — so the fuzzy union (files + code symbols + agents)
// resolves against the current agent's workspace.
export interface MentionAgentRef { id: string; name: string }
export interface MentionTreeNodeRef { path: string; type: string }

export async function searchMentions(
  query: string,
  index: IndexStore,
  agents: MentionAgentRef[],
  workspaceTree: () => MentionTreeNodeRef[],
): Promise<MentionCandidate[]> {
  const q = query.toLowerCase();
  const files = workspaceTree()
    .filter(n => n.type === 'file' && n.path.toLowerCase().includes(q))
    .slice(0, 20)
    .map(n => ({ id: n.path, label: n.path, kind: 'file' as const, path: n.path }));
  const codes = (await index.search(query, 10)).map(r => ({ id: `${r.path}:${r.startLine}`, label: `${r.path}:${r.startLine}`, kind: 'symbol' as const, path: r.path }));
  const ags = agents.filter(a => a.name.toLowerCase().includes(q)).map(a => ({ id: a.id, label: a.name, kind: 'agent' as const }));
  return [...files, ...codes, ...ags];
}
