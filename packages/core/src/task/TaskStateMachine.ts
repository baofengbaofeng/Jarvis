export type TaskState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
export type TaskEvent = 'start' | 'complete' | 'fail' | 'cancel' | 'pause' | 'resume' | 'retry';

const TABLE: Record<TaskState, Partial<Record<TaskEvent, TaskState>>> = {
  queued: { start: 'running', cancel: 'cancelled' },
  running: { complete: 'completed', fail: 'failed', cancel: 'cancelled', pause: 'paused' },
  completed: { retry: 'queued' },
  failed: { retry: 'queued', cancel: 'cancelled' },
  cancelled: { retry: 'queued' },
  paused: { resume: 'running', cancel: 'cancelled' }
};

export function transition(from: TaskState, event: TaskEvent): TaskState {
  const next = TABLE[from][event];
  if (!next) throw new Error(`invalid transition ${from} + ${event}`);
  return next;
}
