import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations, latestVersion } from './migrations';

describe('db migrations', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); });

  it('applies all migrations idempotently', () => {
    applyMigrations(db);
    applyMigrations(db);
    const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number };
    expect(row.v).toBe(latestVersion());
  });

  it('creates core tables', () => {
    applyMigrations(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    const names = tables.map(t => t.name);
    for (const t of ['settings','providers','models','agents','chat_sessions','chat_messages','mcp_servers','skills','prompt_templates','tasks','audit_logs','task_snapshots','code_chunks']) {
      expect(names).toContain(t);
    }
  });

  // M5 Task 10 (L21): v3 creates the three FTS5 virtual tables.
  it('creates FTS5 virtual tables (v3)', () => {
    applyMigrations(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    const names = tables.map(t => t.name);
    for (const t of ['chat_messages_fts','agents_fts','tasks_fts']) {
      expect(names).toContain(t);
    }
  });

  it('reports latestVersion as 4 (v4 adds agent_messages.task_id + bus indexes)', () => {
    expect(latestVersion()).toBe(4);
  });

  // M6 Task 1 (L12): v4 adds task_id to agent_messages (the table was created
  // in v1 with squad_id, which the bus persist INSERT does not use) plus the
  // (to_agent, task_id) and (task_id) lookup indexes the bus needs.
  it('v4 adds agent_messages.task_id and the bus lookup indexes', () => {
    applyMigrations(db);
    const cols = db.prepare('PRAGMA table_info(agent_messages)').all() as Array<{ name: string }>;
    expect(cols.map(c => c.name)).toEqual(expect.arrayContaining(['id','kind','from_agent','to_agent','task_id','payload_json','created_at']));
    const idxs = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='agent_messages'").all() as Array<{ name: string }>;
    expect(idxs.map(i => i.name)).toEqual(expect.arrayContaining(['idx_agent_messages_to_task','idx_agent_messages_task']));
  });
});
