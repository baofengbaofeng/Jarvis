import { describe, it, expect } from 'vitest';
import { transition } from './TaskStateMachine';

describe('TaskStateMachine', () => {
  it('follows happy path', () => {
    expect(transition('queued', 'start')).toBe('running');
    expect(transition('running', 'complete')).toBe('completed');
  });
  it('allows retry from failed', () => {
    expect(transition('failed', 'retry')).toBe('queued');
  });
  it('rejects illegal transition', () => {
    expect(() => transition('completed', 'start')).toThrow('invalid transition');
  });
});
