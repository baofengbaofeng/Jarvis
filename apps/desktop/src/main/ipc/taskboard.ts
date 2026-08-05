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
        error: parseResultError(r.resultJson as string | null),
      }));
  return { list };
}

// M8 final review: result_json is free-form task output — never trust it to be
// valid JSON. A malformed row degrades to no error instead of breaking the list.
function parseResultError(json: string | null): string | undefined {
  if (!json) return undefined;
  try { return (JSON.parse(json) as { error?: string }).error; } catch { return undefined; }
}
