import { describe, it, expect } from 'vitest';
import { squadTransition, createSquad } from './SquadMachine';

describe('squad state machine', () => {
  it('follows the happy path', () => {
    let s = squadTransition('idle', 'start');
    s = squadTransition(s, 'summarized');
    expect(s).toBe('in_review');
    expect(squadTransition(s, 'approve')).toBe('completed');
  });

  it('rejects from in_review goes back to in_progress', () => {
    expect(squadTransition('in_review', 'reject')).toBe('in_progress');
  });

  it('throws on invalid transition', () => {
    expect(() => squadTransition('completed', 'start')).toThrow('invalid transition');
  });

  it('creates a squad with default idle status', () => {
    const s = createSquad({ leaderAgentId: 'l', memberAgentIds: ['m1', 'm2'] });
    expect(s.status).toBe('idle');
    expect(s.memberAgentIds).toHaveLength(2);
  });
});
