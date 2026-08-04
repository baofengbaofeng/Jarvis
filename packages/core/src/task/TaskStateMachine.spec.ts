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
  it('allows a paused task to cancel, complete, or fail', () => {
    expect(transition('paused', 'cancel')).toBe('cancelled');
    expect(transition('paused', 'complete')).toBe('completed');
    expect(transition('paused', 'fail')).toBe('failed');
  });
  it('rejects illegal transition', () => {
    expect(() => transition('completed', 'start')).toThrow('invalid transition');
  });
});
