import type { Database } from 'better-sqlite3';
import type { Artifact } from '@jarvis/core';

// M8 Task 10 (K6): canvas workspace artifact IPC. The task completion path
// (tasks.ts onDone) calls createArtifactsIpc(db).save for every artifact
// captureArtifacts extracts from the final result text; the renderer CanvasView
// calls artifacts.list to render a task's artifacts. `save` returns the new row
// id; `list` returns rows newest-first (AUTOINCREMENT id ordering approximates
// creation order, matching the migration's created_at default).
export function createArtifactsIpc(db: Database) {
  const save = (_e: unknown, a: Omit<Artifact, 'id'>) => {
    const info = db.prepare('INSERT INTO task_artifacts (task_id, kind, title, content) VALUES (?,?,?,?)').run(a.taskId, a.kind, a.title ?? null, a.content);
    return { id: String(info.lastInsertRowid) };
  };
  const list = (_e: unknown, taskId: string): Artifact[] =>
    (db.prepare('SELECT id, task_id AS taskId, kind, title, content FROM task_artifacts WHERE task_id = ? ORDER BY id').all(taskId) as Array<Record<string, unknown>>)
      .map(r => ({ id: String(r.id), taskId: r.taskId as string, kind: r.kind as Artifact['kind'], title: (r.title as string | null) ?? undefined, content: r.content as string }));
  return { save, list };
}
