import { describe, it, expect } from 'vitest';
import { buildTaskNotification } from './Notify';

describe('notify policy', () => {
  it('notifies only on complete and failed', () => {
    expect(buildTaskNotification('complete', { title: 't' }).notify).toBe(true);
    expect(buildTaskNotification('failed', { title: 't' }).notify).toBe(true);
    expect(buildTaskNotification('running', { title: 't' }).notify).toBe(false);
  });
});
