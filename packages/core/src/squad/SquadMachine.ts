export type SquadStatus = 'idle' | 'in_progress' | 'in_review' | 'completed' | 'cancelled' | 'failed';
export type SquadEvent = 'start' | 'summarized' | 'approve' | 'reject' | 'cancel' | 'fail';
export class SquadStateError extends Error {}

const TRANSITIONS: Record<SquadStatus, Partial<Record<SquadEvent, SquadStatus>>> = {
  idle: { start: 'in_progress', cancel: 'cancelled', fail: 'failed' },
  in_progress: { summarized: 'in_review', cancel: 'cancelled', fail: 'failed' },
  in_review: { approve: 'completed', reject: 'in_progress', cancel: 'cancelled' },
  completed: {},
  cancelled: {},
  failed: {}
};

export function squadTransition(state: SquadStatus, event: SquadEvent): SquadStatus {
  const next = TRANSITIONS[state]?.[event];
  if (!next) throw new SquadStateError(`invalid transition ${state} --${event}-> ?`);
  return next;
}

export interface Squad { id: string; leaderAgentId: string; memberAgentIds: string[]; status: SquadStatus; taskId?: string }

export function createSquad(input: { leaderAgentId: string; memberAgentIds: string[]; id?: string; status?: SquadStatus; taskId?: string }): Squad {
  return {
    id: input.id ?? '', leaderAgentId: input.leaderAgentId, memberAgentIds: input.memberAgentIds,
    status: input.status ?? 'idle', taskId: input.taskId
  };
}
