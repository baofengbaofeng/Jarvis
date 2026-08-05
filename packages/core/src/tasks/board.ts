// K4 Task 看板 (M8 Task 1): pure board-shaping logic for the six-column kanban.
// Lives in core (not the desktop app) so the grouping/order rules are
// unit-testable without an Electron process, and is safe to re-export from the
// renderer entry (no node:* imports — see renderer.ts).

export type TaskStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export interface TaskSummary { id: string; agentId?: string; status: TaskStatus; createdAt: string; completedAt?: string; error?: string }
export interface BoardColumns { queued: TaskSummary[]; running: TaskSummary[]; paused: TaskSummary[]; completed: TaskSummary[]; failed: TaskSummary[]; cancelled: TaskSummary[] }

export function boardOrder(): TaskStatus[] { return ['queued', 'running', 'paused', 'completed', 'failed', 'cancelled']; }

export function groupByStatus(tasks: TaskSummary[]): BoardColumns {
  const cols: BoardColumns = { queued: [], running: [], paused: [], completed: [], failed: [], cancelled: [] };
  for (const task of tasks) cols[task.status]?.push(task);
  for (const status of boardOrder()) cols[status].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return cols;
}
