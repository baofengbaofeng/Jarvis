import type Database from 'better-sqlite3';
import type { AuditEntry, AuditSink } from '@jarvis/core';

// M8 Task 3 (J5): persistent audit sink over the audit_logs table (migration
// v11). The INSERT omits `ts` (column defaults to datetime('now')) and `id`
// (autoincrements). target/detail/taskId are normalized to NULL so a missing
// optional field never trips a NOT NULL — the table only marks kind/action/
// result as required.
export function sqliteAuditSink(db: Database.Database): AuditSink {
  const stmt = db.prepare(`INSERT INTO audit_logs (kind, actor, action, target, result, detail, task_id)
    VALUES (@kind, @actor, @action, @target, @result, @detail, @taskId)`);
  return { write: (e: AuditEntry) => { stmt.run({ ...e, target: e.target ?? null, detail: e.detail ?? null, taskId: e.taskId ?? null }); } };
}
