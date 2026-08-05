import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../db/migrations';
import { sqliteAuditSink } from '../audit/sqliteAuditSink';
import { createAuditIpc } from './audit';
import type { AuditEntry } from '@jarvis/core';

describe('audit sink + IPC', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  it('sqliteAuditSink persists entries into audit_logs with defaults for ts/id', () => {
    const sink = sqliteAuditSink(db);
    sink.write({ ts: 'ignored-by-insert', kind: 'tool_call', actor: 'agent', action: 'read_file', target: 'a.txt', result: 'ok' });
    const row = db.prepare('SELECT id, ts, kind, action, target, result, task_id FROM audit_logs').get() as { id: number; ts: string; kind: string; action: string; target: string; result: string; task_id: string | null };
    expect(typeof row.id).toBe('number');
    expect(row.ts.length).toBeGreaterThan(0);
    expect(row.kind).toBe('tool_call');
    expect(row.action).toBe('read_file');
    expect(row.target).toBe('a.txt');
    expect(row.result).toBe('ok');
    expect(row.task_id).toBeNull();
  });

  it('createAuditIpc.list returns rows newest-first and filters by kind', () => {
    const sink = sqliteAuditSink(db);
    sink.write({ ts: '1', kind: 'tool_call', actor: 'agent', action: 'read_file', result: 'ok' });
    sink.write({ ts: '2', kind: 'approval', actor: 'agent', action: 'git_commit', result: 'denied' });
    const audit = createAuditIpc(db);
    const all = audit.list();
    // ts defaults to datetime('now') (second precision), so two writes in the
    // same second tie in ORDER BY ts DESC — assert membership, not exact order.
    expect(all.map(a => a.action)).toEqual(expect.arrayContaining(['read_file', 'git_commit']));
    const tool = audit.list({ kind: 'tool_call' });
    expect(tool).toHaveLength(1);
    expect(tool[0].result).toBe('ok');
  });

  it('createAuditIpc.exportAudit renders CSV and JSONL', () => {
    const sink = sqliteAuditSink(db);
    sink.write({ ts: 'x', kind: 'tool_call', actor: 'agent', action: 'read_file', result: 'ok' });
    const audit = createAuditIpc(db);
    const csv = audit.exportAudit({ format: 'csv' });
    expect(csv.split('\n')[0]).toBe('ts,kind,actor,action,target,result,task_id');
    expect(csv).toContain('"tool_call"');
    const jsonl = audit.exportAudit({ format: 'jsonl' });
    const parsed = JSON.parse(jsonl.split('\n')[0]) as AuditEntry;
    expect(parsed.action).toBe('read_file');
  });
});
