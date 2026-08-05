import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { MessageBus } from '@jarvis/core';
import { applyMigrations } from '../db/migrations';
import { createBusPersist, getMessageBus } from './squad';

// M6 Task 1 (L12): the main-owned agent_messages table must persist every
// message posted to the shared bus. getMessageBus is a process-wide singleton,
// so each test wires its own fresh bus instance to keep assertions isolated;
// the singleton itself is exercised by IpcRouter.registerAll (see IpcRouter.spec).
describe('squad bus persistence (L12)', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  it('createBusPersist writes every posted message to agent_messages', () => {
    const bus = new MessageBus();
    createBusPersist(db, bus);
    const posted = bus.post({ kind: 'delegate', from: 'leader', to: 'member', taskId: 't1', payload: { subtask: 'x' } });
    const row = db.prepare('SELECT id, kind, from_agent, to_agent, task_id, payload_json, created_at FROM agent_messages').get() as {
      id: string; kind: string; from_agent: string; to_agent: string; task_id: string | null; payload_json: string; created_at: string;
    };
    expect(row).toMatchObject({
      id: posted.id,
      kind: 'delegate',
      from_agent: 'leader',
      to_agent: 'member',
      task_id: 't1',
      payload_json: JSON.stringify({ subtask: 'x' })
    });
    expect(new Date(row.created_at).getTime()).toBe(posted.ts);
  });

  it('persists null task_id for messages without one', () => {
    const bus = new MessageBus();
    createBusPersist(db, bus);
    bus.post({ kind: 'log', from: 'a', to: '*', payload: { note: 1 } });
    const row = db.prepare('SELECT task_id, payload_json FROM agent_messages').get() as { task_id: string | null; payload_json: string };
    expect(row.task_id).toBeNull();
    expect(row.payload_json).toBe('{"note":1}');
  });

  it('getMessageBus returns the same singleton instance', () => {
    expect(getMessageBus()).toBe(getMessageBus());
  });
});
