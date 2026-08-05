export interface NotifyDecision { notify: boolean; title: string; body: string }
export type TaskEndStatus = 'complete' | 'failed' | 'running';

export function buildTaskNotification(status: TaskEndStatus, task: { title: string }): NotifyDecision {
  if (status !== 'complete' && status !== 'failed') return { notify: false, title: '', body: '' };
  return { notify: true, title: `Task ${status}`, body: task.title };
}
