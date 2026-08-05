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

  it('reports latestVersion as 3 (v3 adds FTS5 chat/agent/task index)', () => {
    expect(latestVersion()).toBe(3);
  });
});
