import { describe, it, expect } from 'vitest';
import { runSquad } from './SquadRouter';

describe('runSquad', () => {
  it('delegates to members and summarizes into in_review', async () => {
    const deps = {
      runLeader: async () => ({ text: 'plan', delegations: [{ to: 'm1', subtask: 'a' }, { to: 'm2', subtask: 'b' }] }),
      runMember: async (agentId: string) => `result of ${agentId}`,
      buildContext: async (_memberId: string, s: string) => s,
      summarize: async (members: Array<{ agent: string; result: string }>) => members.map(m => m.result).join(';')
    };
    const squad = { id: 's1', leaderAgentId: 'leader', memberAgentIds: ['m1', 'm2'], status: 'in_progress' as const };
    const r = await runSquad(squad, 'task input', deps);
    expect(r.status).toBe('in_review');
    expect(r.members).toHaveLength(2);
    expect(r.summary).toContain('result of m1');
  });
});
