import type { Squad } from './SquadMachine';

export interface SquadRouterDeps {
  runLeader(input: string): Promise<{ text: string; delegations: Array<{ to: string; subtask: string }> }>;
  runMember(agentId: string, subtask: string, context: string): Promise<string>;
  // memberId is the RECEIVING member (d.to) so the caller can apply that
  // member's configured context_passing strategy (L13) — the leader's own
  // strategy does not govern what each member is handed.
  buildContext(memberId: string, result: string): Promise<string>;
  summarize(members: Array<{ agent: string; result: string }>): Promise<string>;
}
export interface SquadResult { squadId: string; status: 'in_review'; summary: string; members: Array<{ agent: string; result: string }> }

export async function runSquad(squad: Squad, taskInput: string, deps: SquadRouterDeps): Promise<SquadResult> {
  const { delegations } = await deps.runLeader(taskInput);
  const members: Array<{ agent: string; result: string }> = [];
  for (const d of delegations.slice(0, squad.memberAgentIds.length)) {
    const context = await deps.buildContext(d.to, `[Leader 指示]\n${taskInput}`);
    const result = await deps.runMember(d.to, d.subtask, context);
    members.push({ agent: d.to, result });
  }
  const summary = await deps.summarize(members);
  return { squadId: squad.id, status: 'in_review', summary, members };
}
