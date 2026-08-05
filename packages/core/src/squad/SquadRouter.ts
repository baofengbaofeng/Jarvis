import type { Squad } from './SquadMachine';

export interface SquadRouterDeps {
  runLeader(input: string): Promise<{ text: string; delegations: Array<{ to: string; subtask: string }> }>;
  runMember(agentId: string, subtask: string, context: string): Promise<string>;
  buildContext(result: string): Promise<string>;
  summarize(members: Array<{ agent: string; result: string }>): Promise<string>;
}
export interface SquadResult { squadId: string; status: 'in_review'; summary: string; members: Array<{ agent: string; result: string }> }

export async function runSquad(squad: Squad, taskInput: string, deps: SquadRouterDeps): Promise<SquadResult> {
  const { delegations } = await deps.runLeader(taskInput);
  const members: Array<{ agent: string; result: string }> = [];
  for (const d of delegations.slice(0, squad.memberAgentIds.length)) {
    const context = await deps.buildContext(`[Leader 指示]\n${taskInput}`);
    const result = await deps.runMember(d.to, d.subtask, context);
    members.push({ agent: d.to, result });
  }
  const summary = await deps.summarize(members);
  return { squadId: squad.id, status: 'in_review', summary, members };
}
