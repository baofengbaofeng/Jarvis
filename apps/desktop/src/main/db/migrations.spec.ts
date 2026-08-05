import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations, latestVersion, MIGRATIONS } from './migrations';

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

  it('reports latestVersion as 10 (v5 reshapes squads for the M6 squad model; v6 adds agents.context_passing; v7 reshapes agent_call_edges for L14; v8 adds agent_memory/agent_config_versions for F11; v9 adds the L36 tasks.multica_task_id unique index; v10 creates the B9 token_usage table)', () => {
    expect(latestVersion()).toBe(10);
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

  // M6 Task 7 (F11): v8 creates the persistent-agent-memory store
  // (agent_memory with UNIQUE(agent_id, key)) and the agent config versioning
  // table (agent_config_versions, empty until M6 Task 9).
  it('v8 creates agent_memory and agent_config_versions', () => {
    applyMigrations(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    const names = tables.map(t => t.name);
    for (const t of ['agent_memory', 'agent_config_versions']) {
      expect(names).toContain(t);
    }
    // UNIQUE(agent_id, key) backs the adapter's ON CONFLICT upsert.
    const idxs = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='agent_memory'").all() as Array<{ name: string }>;
    expect(idxs.map(i => i.name)).toContain('idx_agent_memory_agent');
    // The table is idempotent: re-applying migrations must not throw.
    applyMigrations(db);
  });

  // M6 Task 5 (L14): v7 reshapes the v1 agent_call_edges table (legacy
  // task_hash, no ok/squad_id) into the L14 model — task_id + ok + squad_id,
  // indexed by squad_id for the squad.graph lookup. The INSERT the delegation
  // route issues omits task_hash, so the column must be gone for edge writes to
  // work.
  it('v7 reshapes agent_call_edges to the L14 call-graph model (renames task_hash, adds ok + squad_id)', () => {
    applyMigrations(db);
    const cols = db.prepare('PRAGMA table_info(agent_call_edges)').all() as Array<{ name: string; notnull: number; dflt_value: unknown }>;
    expect(cols.map(c => c.name)).toEqual(expect.arrayContaining(['id','from_agent','to_agent','task_id','ok','squad_id','created_at']));
    expect(cols.map(c => c.name)).not.toContain('task_hash');
    const ok = cols.find(c => c.name === 'ok');
    expect(ok?.notnull).toBe(1);
    const idxs = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='agent_call_edges'").all() as Array<{ name: string }>;
    expect(idxs.map(i => i.name)).toContain('idx_agent_call_edges_squad');
    // The delegation-route INSERT (task_id + squad_id, no task_hash) must work.
    db.prepare('INSERT INTO agent_call_edges (id, from_agent, to_agent, task_id, squad_id, ok, created_at) VALUES (?,?,?,?,?,?,?)')
      .run('e1', 'leader', 'member', 't1', 's1', 1, new Date().toISOString());
    const row = db.prepare('SELECT task_id, squad_id, ok FROM agent_call_edges WHERE id = ?').get('e1') as { task_id: string; squad_id: string; ok: number };
    expect(row).toEqual({ task_id: 't1', squad_id: 's1', ok: 1 });
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

  // M7 Task 6 (L36): v9 backs the daemon's local<->multica task id mapping.
  // The v1 tasks table ALREADY has multica_task_id TEXT UNIQUE, so v9 does NOT
  // ALTER the table (that would fail on existing DBs) — it only adds the unique
  // partial index, which enforces one multica id per local task while letting
  // the many legacy NULL rows coexist.
  it('v9 creates the unique tasks.multica_task_id index (L36 id mapping)', () => {
    applyMigrations(db);
    const idxs = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='tasks'").all() as Array<{ name: string; sql: string }>;
    const idx = idxs.find(i => i.name === 'idx_tasks_multica_task_id');
    expect(idx).toBeDefined();
    expect(idx!.sql).toContain('UNIQUE');
    expect(idx!.sql).toContain('multica_task_id IS NOT NULL');
    // The partial index allows many NULL multica ids...
    const now = new Date().toISOString();
    db.prepare('INSERT INTO tasks (id, agent_id, status, payload_json, created_at) VALUES (?,?,?,?,?)').run('t1', 'a1', 'queued', '{}', now);
    db.prepare('INSERT INTO tasks (id, agent_id, status, payload_json, created_at) VALUES (?,?,?,?,?)').run('t2', 'a1', 'queued', '{}', now);
    db.prepare('UPDATE tasks SET multica_task_id = ? WHERE id = ?').run('mt-1', 't1');
    // ...but rejects a second local task mapped to the same multica id.
    expect(() => db.prepare('UPDATE tasks SET multica_task_id = ? WHERE id = ?').run('mt-1', 't2')).toThrow(/UNIQUE/);
    // Re-applying stays idempotent.
    applyMigrations(db);
  });

  it('v9 sql mentions multica_task_id and UNIQUE INDEX', () => {
    const v9 = MIGRATIONS.find((m) => m.version === 9);
    expect(v9).toBeDefined();
    expect(v9!.sql).toContain('multica_task_id');
    expect(v9!.sql).toContain('UNIQUE INDEX');
  });

  // M8 Task 2 (B9): v10 replaces the vestigial v1 token_usage table with the
  // real shape (agent_id/model_id/cost_estimate). The v1 table would otherwise
  // make a plain CREATE TABLE IF NOT EXISTS a no-op and break the UsageTracker
  // INSERT; v10 DROPs it first, so the reshape is effective on fresh AND
  // upgraded databases.
  it('v10 creates the B9 token_usage table with agent_id/model_id/cost_estimate', () => {
    applyMigrations(db);
    const cols = db.prepare('PRAGMA table_info(token_usage)').all() as Array<{ name: string }>;
    expect(cols.map(c => c.name)).toEqual(expect.arrayContaining([
      'id', 'task_id', 'session_id', 'agent_id', 'model_id',
      'prompt_tokens', 'completion_tokens', 'total_tokens', 'cost_estimate', 'created_at'
    ]));
    // The UsageTracker INSERT shape must work end to end against the migrated table.
    db.prepare('INSERT INTO token_usage (task_id, agent_id, model_id, prompt_tokens, completion_tokens, total_tokens, cost_estimate) VALUES (?,?,?,?,?,?,?)')
      .run('t1', 'a1', 'claude-3-5-sonnet', 10, 5, 15, null);
    const row = db.prepare('SELECT agent_id, model_id, total_tokens FROM token_usage WHERE task_id = ?').get('t1') as { agent_id: string; model_id: string; total_tokens: number };
    expect(row).toEqual({ agent_id: 'a1', model_id: 'claude-3-5-sonnet', total_tokens: 15 });
    // Idempotent: re-applying migrations must not throw.
    applyMigrations(db);
  });
});
