import type Database from 'better-sqlite3';

export interface Migration { version: number; sql: string }

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('openai-compatible','anthropic-compatible')),
        base_url TEXT NOT NULL,
        api_key_ref TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS models (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        model_id TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        system_prompt TEXT NOT NULL DEFAULT '',
        model_id TEXT REFERENCES models(id),
        workspace_id TEXT,
        context_budget_tokens INTEGER NOT NULL DEFAULT 128000,
        plan_only INTEGER NOT NULL DEFAULT 0,
        env_vars_json TEXT NOT NULL DEFAULT '{}',
        cli_args_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '新对话',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        transport TEXT NOT NULL CHECK (transport IN ('stdio','sse','http')),
        config_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS prompt_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        payload_json TEXT NOT NULL,
        result_json TEXT,
        error_json TEXT,
        multica_task_id TEXT UNIQUE,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE TABLE IF NOT EXISTS squads (
        id TEXT PRIMARY KEY,
        leader_agent_id TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_messages (
        id TEXT PRIMARY KEY,
        squad_id TEXT REFERENCES squads(id) ON DELETE CASCADE,
        from_agent TEXT NOT NULL,
        to_agent TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_call_edges (
        id TEXT PRIMARY KEY,
        from_agent TEXT NOT NULL,
        to_agent TEXT NOT NULL,
        task_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        agent_id TEXT,
        kind TEXT NOT NULL,
        detail_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS token_usage (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        session_id TEXT,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runtime_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        config_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mcp_grants (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        server_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        granted INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
    `
  },
  {
    version: 2,
    sql: `CREATE TABLE IF NOT EXISTS task_snapshots (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, kind TEXT NOT NULL,
      meta_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_task_snapshots_task ON task_snapshots(task_id);
    CREATE TABLE IF NOT EXISTS code_chunks (
      id TEXT PRIMARY KEY, path TEXT NOT NULL, start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL, text TEXT NOT NULL, embedding_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_code_chunks_path ON code_chunks(path);`
  },
  // M5 Task 10 (L21): global FTS5 search. The brief's tasks_fts(title,
  // description) does NOT match the real schema — `tasks` has no title/
  // description columns, it carries payload_json/result_json/error_json (the
  // agents table has name+description, chat_messages has content — those two
  // match). So the FTS tables here index the ACTUAL columns: chat_messages
  // content, agents name+description, tasks payload+result. All three source
  // tables have an implicit INTEGER rowid (TEXT PK, not WITHOUT ROWID), so the
  // `new.rowid`/`old.rowid` triggers and `SELECT rowid` backfills are valid.
  //
  // tokenize='trigram': the default unicode61 tokenizer treats a CJK run as ONE
  // token, so a Chinese substring query (the app is zh-CN first) can never match
  // inside a longer string. Trigram indexes 3-char substrings, which makes
  // Chinese substring search actually work (queries < 3 chars just match
  // nothing, they do not throw). SQLite 3.49.2 (bundled with better-sqlite3)
  // supports it.
  //
  // Unlike the brief, UPDATE triggers (_au) are included: a regular FTS5 table
  // does not follow source-row updates, so agents/tasks/chat edits would leave
  // stale rows searchable. Idempotent: the virtual tables/triggers use IF NOT
  // EXISTS and applyMigrations records the version once, so the backfills below
  // run exactly once per database.
  {
    version: 3,
    sql: `
    CREATE VIRTUAL TABLE IF NOT EXISTS chat_messages_fts USING fts5(content, tokenize='trigram');
    CREATE VIRTUAL TABLE IF NOT EXISTS agents_fts USING fts5(name, description, tokenize='trigram');
    CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(payload, result, tokenize='trigram');
    CREATE TRIGGER IF NOT EXISTS chat_messages_fts_ai AFTER INSERT ON chat_messages BEGIN
      INSERT INTO chat_messages_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS chat_messages_fts_ad AFTER DELETE ON chat_messages BEGIN
      DELETE FROM chat_messages_fts WHERE rowid = old.rowid;
    END;
    CREATE TRIGGER IF NOT EXISTS chat_messages_fts_au AFTER UPDATE OF content ON chat_messages BEGIN
      DELETE FROM chat_messages_fts WHERE rowid = old.rowid;
      INSERT INTO chat_messages_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS agents_fts_ai AFTER INSERT ON agents BEGIN
      INSERT INTO agents_fts(rowid, name, description) VALUES (new.rowid, new.name, new.description);
    END;
    CREATE TRIGGER IF NOT EXISTS agents_fts_ad AFTER DELETE ON agents BEGIN
      DELETE FROM agents_fts WHERE rowid = old.rowid;
    END;
    CREATE TRIGGER IF NOT EXISTS agents_fts_au AFTER UPDATE OF name, description ON agents BEGIN
      DELETE FROM agents_fts WHERE rowid = old.rowid;
      INSERT INTO agents_fts(rowid, name, description) VALUES (new.rowid, new.name, new.description);
    END;
    CREATE TRIGGER IF NOT EXISTS tasks_fts_ai AFTER INSERT ON tasks BEGIN
      INSERT INTO tasks_fts(rowid, payload, result) VALUES (new.rowid, new.payload_json, new.result_json);
    END;
    CREATE TRIGGER IF NOT EXISTS tasks_fts_ad AFTER DELETE ON tasks BEGIN
      DELETE FROM tasks_fts WHERE rowid = old.rowid;
    END;
    CREATE TRIGGER IF NOT EXISTS tasks_fts_au AFTER UPDATE OF payload_json, result_json ON tasks BEGIN
      DELETE FROM tasks_fts WHERE rowid = old.rowid;
      INSERT INTO tasks_fts(rowid, payload, result) VALUES (new.rowid, new.payload_json, new.result_json);
    END;
    INSERT INTO chat_messages_fts(rowid, content) SELECT rowid, content FROM chat_messages;
    INSERT INTO agents_fts(rowid, name, description) SELECT rowid, name, description FROM agents;
    INSERT INTO tasks_fts(rowid, payload, result) SELECT rowid, payload_json, result_json FROM tasks;`
  },
  // M6 Task 1 (L12): agent message bus persistence. The agent_messages table
  // ALREADY exists from v1 — but with squad_id, not the task_id the bus INSERT
  // (main/ipc/squad.ts createBusPersist) needs to match responses to pending
  // waiters by (to, taskId). So v4 ALTERs the column in and creates the two
  // lookup indexes instead of re-CREATEing the table (which the v1 IF NOT
  // EXISTS would have made a no-op). schema_migrations version tracking
  // guarantees the ALTER runs exactly once per database, so it needs no
  // idempotency guard — SQLite has no IF NOT EXISTS for ADD COLUMN.
  {
    version: 4,
    sql: `
    ALTER TABLE agent_messages ADD COLUMN task_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_agent_messages_to_task ON agent_messages(to_agent, task_id);
    CREATE INDEX IF NOT EXISTS idx_agent_messages_task ON agent_messages(task_id);`
  },
  // M6 Task 3 (F8/F9): squad state machine persistence. The v1 schema created
  // squads with a legacy `name TEXT NOT NULL` column and no member/task columns,
  // which does NOT match the M6 squad model (leader + members + a bound task) —
  // the createSquadStore INSERT never provides `name`, so a NOT NULL name would
  // make every squad insert fail. ALTER in place like v4 did for agent_messages
  // (the v1 CREATE TABLE IF NOT EXISTS would make a plain re-CREATE a no-op):
  // drop the unused name column, add member_agent_ids_json + task_id, and index
  // by status. schema_migrations version tracking guarantees the DROP/ADD run
  // exactly once per database (SQLite has no idempotency guard for them, and
  // better-sqlite3 bundles SQLite >= 3.35 so DROP COLUMN is supported). No
  // squad rows exist yet, so dropping name loses nothing.
  {
    version: 5,
    sql: `
    ALTER TABLE squads DROP COLUMN name;
    ALTER TABLE squads ADD COLUMN member_agent_ids_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE squads ADD COLUMN task_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_squads_status ON squads(status);`
  },
  // M6 Task 4 (L13): per-agent squad context-passing strategy. Existing agents
  // default to 'full' (leader context passed verbatim) so they keep working
  // with no reconfiguration; the value is free-form TEXT because the protocol
  // union (full/summary/conclusion/custom) is validated at the store boundary,
  // not by SQLite CHECK (matching how env_vars_json/cli_args_json are stored).
  {
    version: 6,
    sql: `
    ALTER TABLE agents ADD COLUMN context_passing TEXT NOT NULL DEFAULT 'full';`
  },
  // M6 Task 5 (L14): call-graph tracking. The v1 schema already created
  // agent_call_edges with a legacy shape (task_hash TEXT NOT NULL, no ok, no
  // squad_id) that does NOT match the L14 model — the brief's INSERT passes
  // task_id + ok, and squad.graph must find a squad's edges by squad_id (the
  // delegation's task_id equals the squad row id here, not the squad's bound
  // task_id). So v7 ALTERs in place like v4/v5 did for agent_messages/squads
  // (the v1 CREATE TABLE IF NOT EXISTS would make a re-CREATE a no-op): rename
  // task_hash -> task_id, add ok (default 1 for legacy rows) + squad_id, and
  // index by squad_id for the graph lookup. schema_migrations version tracking
  // guarantees the RENAME/ADD run exactly once per database (better-sqlite3
  // bundles SQLite >= 3.25 so RENAME COLUMN is supported).
  {
    version: 7,
    sql: `
    ALTER TABLE agent_call_edges RENAME COLUMN task_hash TO task_id;
    ALTER TABLE agent_call_edges ADD COLUMN ok INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE agent_call_edges ADD COLUMN squad_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_agent_call_edges_squad ON agent_call_edges(squad_id);`
  },
  // M6 Task 7 (F11): persistent agent memory. Unlike v4/v5/v7 these are brand-new
  // tables (agent_memory / agent_config_versions), so plain IF NOT EXISTS CREATE
  // is idempotent — no in-place ALTER needed. agent_memory is the F11 store:
  // one row per (agent_id, key), UNIQUE so createMemoryAdapter's
  // INSERT ... ON CONFLICT(agent_id, key) DO UPDATE upsert works. The
  // updated_at is refreshed by the adapter, not here. agent_config_versions is
  // created now for M6 Task 9 (agent config versioning) — empty until then.
  {
    version: 8,
    sql: `
    CREATE TABLE IF NOT EXISTS agent_memory (
      id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, key TEXT NOT NULL,
      value TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(agent_id, key)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_memory_agent ON agent_memory(agent_id);
    CREATE TABLE IF NOT EXISTS agent_config_versions (
      id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_config_versions_agent ON agent_config_versions(agent_id, created_at);`
  },
  // M7 Task 6 (L36): local<->multica task id mapping. The `tasks` table ALREADY
  // carries `multica_task_id TEXT UNIQUE` from migration v1, so this migration
  // must NOT ALTER it (that would fail on any existing DB). It only creates the
  // unique index the daemon's db.MapTaskIDs round-trip relies on; a partial
  // index (WHERE multica_task_id IS NOT NULL) so the many NULL rows from legacy
  // tasks do not collide. Version 9 (not 5): v5 was already consumed by the M6
  // squad reshape, so the M7 plan's "v5" became 9 in sequence.
  {
    version: 9,
    sql: `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_multica_task_id ON tasks(multica_task_id) WHERE multica_task_id IS NOT NULL;`
  },
  // M8 Task 2 (B9): token usage tracking. The v1 schema ALREADY created a
  // token_usage table with a vestigial shape (id TEXT PRIMARY KEY, no
  // agent_id/model_id/cost_estimate) that NOTHING writes to — but its existence
  // would make the B9 `CREATE TABLE IF NOT EXISTS` below a no-op and leave the
  // UsageTracker INSERT (which includes agent_id/model_id/cost_estimate) broken
  // on every database, fresh or upgraded. The old table is dead (no code reads
  // or writes it), so DROP it and create the real shape. schema_migrations
  // version tracking runs v10 exactly once, so the DROP/CREATE is safe.
  {
    version: 10,
    sql: `
    DROP TABLE IF EXISTS token_usage;
    CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT,
      session_id TEXT,
      agent_id TEXT,
      model_id TEXT,
      prompt_tokens INTEGER NOT NULL,
      completion_tokens INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL,
      cost_estimate REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`
  }
];

export function latestVersion(): number {
  return MIGRATIONS[MIGRATIONS.length - 1].version;
}

export function applyMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);`);
  const applied = new Set((db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map(r => r.version));
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.exec(m.sql);
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(m.version, new Date().toISOString());
  }
}

export function runMigrations(db: Database.Database): void {
  applyMigrations(db);
}
