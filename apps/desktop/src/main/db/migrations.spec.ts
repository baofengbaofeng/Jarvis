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

  it('reports latestVersion as 6 (v5 reshapes squads for the M6 squad model; v6 adds agents.context_passing)', () => {
    expect(latestVersion()).toBe(6);
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

  // M6 Task 4 (L13): v6 adds agents.context_passing, defaulting to 'full' so
  // existing agents keep passing the leader context verbatim until configured.
  it('v6 adds agents.context_passing defaulting to full', () => {
    applyMigrations(db);
    const cols = db.prepare('PRAGMA table_info(agents)').all() as Array<{ name: string; dflt_value: unknown }>;
    const col = cols.find(c => c.name === 'context_passing');
    expect(col).toBeDefined();
    expect(col?.dflt_value).toBe("'full'");
    // A row inserted without the column picks up the default.
    const now = new Date().toISOString();
    db.prepare('INSERT INTO agents (id, name, slug, description, system_prompt, model_id, workspace_id, context_budget_tokens, plan_only, env_vars_json, cli_args_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('a1', 'A', 'a', '', '', null, null, 128000, 0, '{}', '[]', now, now);
    expect((db.prepare('SELECT context_passing FROM agents WHERE id = ?').get('a1') as { context_passing: string }).context_passing).toBe('full');
  });

  // M6 Task 3 (F8/F9): v5 reshapes the v1 squads table (legacy `name` column)
  // into the M6 squad model — member_agent_ids_json + task_id, indexed by
  // status. The INSERT the createSquadStore issues omits `name`, so the column
  // must be gone for squad creation to work.
  it('v5 reshapes squads to the M6 squad model (drops name, adds members/task)', () => {
    applyMigrations(db);
    const cols = db.prepare('PRAGMA table_info(squads)').all() as Array<{ name: string; notnull: number; dflt_value: unknown }>;
    expect(cols.map(c => c.name)).toEqual(expect.arrayContaining(['id','leader_agent_id','member_agent_ids_json','status','task_id','created_at']));
    expect(cols.map(c => c.name)).not.toContain('name');
    const member = cols.find(c => c.name === 'member_agent_ids_json');
    expect(member?.notnull).toBe(1);
    const idxs = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='squads'").all() as Array<{ name: string }>;
    expect(idxs.map(i => i.name)).toContain('idx_squads_status');
    // The store INSERT (no name column) must work against the reshaped table.
    db.prepare('INSERT INTO squads (id, leader_agent_id, member_agent_ids_json, status, task_id, created_at) VALUES (?,?,?,?,?,?)')
      .run('s1', 'leader', '["m1","m2"]', 'idle', null, new Date().toISOString());
    expect((db.prepare('SELECT member_agent_ids_json FROM squads WHERE id = ?').get('s1') as { member_agent_ids_json: string }).member_agent_ids_json).toBe('["m1","m2"]');
  });
});
