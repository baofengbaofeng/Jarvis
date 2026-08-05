import type { Database } from 'better-sqlite3';
import type { TaskSummary } from '@jarvis/core';

// K4 Task 看板 (M8 Task 1): read-only taskboard list IPC. The renderer's
// TaskBoard store consumes `taskboard.list` and mutates through the existing
// task.cancel/pause/resume/retry channels. Errors surface as `error` on the
// summary when the task's result_json carries one (failed tasks).
export function createTaskboardIpc(db: Database) {
  const list = (): TaskSummary[] =>
    (db.prepare(`SELECT id, agent_id AS agentId, status, created_at AS createdAt,
                        completed_at AS completedAt, result_json AS resultJson
                 FROM tasks ORDER BY created_at`).all() as Array<Record<string, unknown>>)
      .map(r => ({
        id: r.id as string,
        agentId: r.agentId as string | undefined,
        status: r.status as TaskSummary['status'],
        createdAt: r.createdAt as string,
        completedAt: r.completedAt as string | undefined,
        error: (r.resultJson as string | null) ? ((JSON.parse(r.resultJson as string) as { error?: string }).error) : undefined,
      }));
  return { list };
}
