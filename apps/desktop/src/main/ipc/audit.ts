import type Database from 'better-sqlite3';
import type { AuditEntry } from '@jarvis/core';

// M8 Task 3 (J5): audit read/export IPC. `list` returns the raw rows (latest
// first, capped at 500); `exportAudit` renders them as CSV or JSONL for the
// renderer's dialog.saveText flow. Both take a single object payload, matching
// how AuditLogView invokes 'audit.list' / 'audit.export'.
export function createAuditIpc(db: Database.Database) {
  const list = (filter: { kind?: string; result?: string } = {}): AuditEntry[] => {
    const where: string[] = []; const params: string[] = [];
    if (filter.kind) { where.push('kind = ?'); params.push(filter.kind); }
    if (filter.result) { where.push('result = ?'); params.push(filter.result); }
    const sql = `SELECT kind, action, actor, target, result, detail, task_id AS taskId, ts FROM audit_logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ts DESC LIMIT 500`;
    return db.prepare(sql).all(...params) as AuditEntry[];
  };
  const exportAudit = (filter: { kind?: string; result?: string; format?: 'csv' | 'jsonl' }): string => {
    const rows = list(filter);
    if (filter.format === 'jsonl') return rows.map(r => JSON.stringify(r)).join('\n');
    const header = 'ts,kind,actor,action,target,result,task_id';
    const esc = (v: string) => `"${(v ?? '').replace(/"/g, '""')}"`;
    return [header, ...rows.map(r => [r.ts, r.kind, r.actor ?? '', r.action, r.target ?? '', r.result, r.taskId ?? ''].map(esc).join(','))].join('\n');
  };
  return { list, exportAudit };
}
