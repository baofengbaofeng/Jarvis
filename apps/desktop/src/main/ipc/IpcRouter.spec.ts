import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '../db/migrations';
import { IpcRouter } from './IpcRouter';
import { createProviderStore } from './providers';
import { createAgentStore } from './agents';
import { BackupService } from '../backup/BackupService';
import { getMessageBus, __resetBusForTests } from './squad';
import type { DaemonSupervisor } from '../daemon/DaemonSupervisor';

// IpcRouter imports electron at runtime; stub it so the router can be
// constructed under vitest without a real Electron main process.
vi.mock('electron', () => ({
  app: { relaunch: vi.fn(), quit: vi.fn() },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
}));

// M6 Task 1 (L12) review fix: IpcRouter.registerAll subscribes the SHARED bus
// singleton to persist agent_messages. Reset that singleton before every test
// so a previous test's persist subscription can never fire into this test's db
// (cross-test contamination). dispose() (exercised in the teardown describe
// below) is the production-side release for that subscription.
beforeEach(() => { __resetBusForTests(); });

describe('IpcRouter provider model channels', () => {
  let db: Database.Database;
  const secrets = { set: async () => {}, get: async () => null, delete: async () => {} };

  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  it('registers provider.listModels and provider.addModel against the provider store', async () => {
    const router = new IpcRouter(db);
    const daemon = { status: async () => ({ running: true }), restart: () => {} } as unknown as DaemonSupervisor;
    router.registerAll(daemon);

    const handlers = (router as unknown as { handlers: Map<string, (e: unknown, ...args: unknown[]) => unknown> }).handlers;
    const listModels = handlers.get('provider.listModels')!;
    const addModel = handlers.get('provider.addModel')!;
    expect(listModels).toBeTruthy();
    expect(addModel).toBeTruthy();

    // The registered handlers delegate to the provider store, so a provider
    // created in the UI can immediately be given models through the same IPC.
    const store = createProviderStore(db, secrets);
    const p = await store.create({ name: 'P', type: 'openai-compatible', baseUrl: 'https://x.com', apiKey: 'sk-t' });

    expect(await listModels({}, p.id)).toEqual([]);

    const added = await addModel({}, p.id, { modelId: 'm1', name: 'M1' }) as { providerId: string; modelId: string; name: string };
    expect(added.providerId).toBe(p.id);
    expect(added.modelId).toBe('m1');
    expect(added.name).toBe('M1');

    const models = await listModels({}, p.id) as Array<{ modelId: string }>;
    expect(models).toHaveLength(1);
    expect(models[0].modelId).toBe('m1');
  });
});

// M4 Task 6 (E1/L27): index.reindex walks a real workspace and index.search
// answers against the reindexed code_chunks table — both registered on the router.
describe('IpcRouter code index channels (E1/L27)', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  it('registers index.reindex and index.search and searches a temp workspace', async () => {
    const router = new IpcRouter(db);
    const daemon = { status: async () => ({ running: true }), restart: () => {} } as unknown as DaemonSupervisor;
    router.registerAll(daemon);
    const handlers = (router as unknown as { handlers: Map<string, (e: unknown, ...args: unknown[]) => unknown> }).handlers;
    const reindex = handlers.get('index.reindex')!;
    const search = handlers.get('index.search')!;
    expect(reindex).toBeTruthy();
    expect(search).toBeTruthy();

    const ws = mkdtempSync(join(tmpdir(), 'jarvis-ipc-idx-'));
    try {
      // SEC-07 / workspace-path-guard: reindex only accepts bound workspace roots.
      createAgentStore(db).create({
        name: 'idx',
        systemPrompt: 'x',
        modelId: null,
        workspaceId: ws,
      });
      writeFileSync(join(ws, 'add.ts'), 'export function add(a: number, b: number) { return a + b; }');
      const r = await reindex({}, { workspaceRoot: ws }) as { ok: boolean; indexed: number };
      expect(r.ok).toBe(true);
      expect(r.indexed).toBe(1);
      const rows = await search({}, { query: 'export function add a b', limit: 1 }) as Array<{ path: string }>;
      expect(rows[0].path).toBe('add.ts');
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});

// M5 Task 9 (D15): prompt template library channels registered on the router.
describe('IpcRouter template channels (D15)', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  it('registers templates.list/create/update/delete/render against the store', async () => {
    const router = new IpcRouter(db);
    const daemon = { status: async () => ({ running: true }), restart: () => {} } as unknown as DaemonSupervisor;
    router.registerAll(daemon);
    const handlers = (router as unknown as { handlers: Map<string, (e: unknown, ...args: unknown[]) => unknown> }).handlers;
    const list = handlers.get('templates.list')!;
    const create = handlers.get('templates.create')!;
    const update = handlers.get('templates.update')!;
    const del = handlers.get('templates.delete')!;
    const render = handlers.get('templates.render')!;
    expect(list).toBeTruthy();
    expect(create).toBeTruthy();
    expect(update).toBeTruthy();
    expect(del).toBeTruthy();
    expect(render).toBeTruthy();

    const created = await create({}, { name: 'review', content: 'Review {{name}}' }) as { id: string };
    expect(created.id).toBeTruthy();
    expect((await list({}) as Array<{ id: string; name: string; content: string }>)).toHaveLength(1);

    const rendered = await render({}, { id: created.id, vars: { name: 'Jarvis' } }) as { ok: boolean; result?: string };
    expect(rendered.ok).toBe(true);
    expect(rendered.result).toBe('Review Jarvis');

    const missing = await render({}, { id: 'nope', vars: {} }) as { ok: boolean };
    expect(missing.ok).toBe(false);

    await update({}, created.id, { content: 'Review {{name}} carefully' });
    expect((await list({}) as Array<{ content: string }>)[0].content).toBe('Review {{name}} carefully');

    // The store throws on a missing id; the handler must return { ok:false }
    // rather than let the ipcMain reject.
    const badUpdate = await update({}, 'nope', { content: 'x' }) as { ok: boolean; error?: string };
    expect(badUpdate.ok).toBe(false);
    expect(badUpdate.error).toContain('nope');

    await del({}, created.id);
    expect((await list({}) as unknown[])).toHaveLength(0);
  });
});

// M8 Task 8 (L30): agent template channels. `agent-templates.list` returns the
// seed presets; `agent-templates.createAgent` resolves the template's
// systemPrompt and threads it into the REAL agent store create (modelId:null,
// no skills field). The prefix is agent-templates.* — NOT templates.*, which the
// D15 prompt-template store owns.
describe('IpcRouter agent-templates channels (L30)', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  it('registers agent-templates.list and createAgent against the real agent store', async () => {
    const router = new IpcRouter(db);
    const daemon = { status: async () => ({ running: true }), restart: () => {} } as unknown as DaemonSupervisor;
    router.registerAll(daemon);
    const handlers = (router as unknown as { handlers: Map<string, (e: unknown, ...args: unknown[]) => unknown> }).handlers;
    const list = handlers.get('agent-templates.list')!;
    const createAgent = handlers.get('agent-templates.createAgent')!;
    expect(list).toBeTruthy();
    expect(createAgent).toBeTruthy();

    const templates = await list({}) as Array<{ id: string; category: string; systemPrompt: string }>;
    expect(templates.length).toBeGreaterThanOrEqual(4);
    const coding = templates.find(t => t.id === 'tpl-coding')!;
    expect(coding.category).toBe('coding');
    expect(coding.systemPrompt).toContain('REPL');

    const created = await createAgent({}, { templateId: 'tpl-coding', name: 'Coder', workspaceId: 'ws-1' }) as { id: string; name: string; systemPrompt: string; modelId: string | null; workspaceId: string | null };
    expect(created.id).toBeTruthy();
    expect(created.name).toBe('Coder');
    expect(created.systemPrompt).toBe(coding.systemPrompt);
    expect(created.modelId).toBeNull();
    expect(created.workspaceId).toBe('ws-1');

    // Unknown template -> the handler throws (ipcMain rejection), it does not
    // silently create a wrong agent.
    await expect(createAgent({}, { templateId: 'nope', name: 'X' })).rejects.toThrow('unknown template');
  });
});

// M5 Task 10 (L21): search.global answers against the real FTS5 tables
// (migration v3) seeded through the trigger-populated source tables.
describe('IpcRouter search.global channel (L21)', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  it('registers search.global and searches across the FTS tables', async () => {
    const router = new IpcRouter(db);
    const daemon = { status: async () => ({ running: true }), restart: () => {} } as unknown as DaemonSupervisor;
    router.registerAll(daemon);
    const handlers = (router as unknown as { handlers: Map<string, (e: unknown, ...args: unknown[]) => unknown> }).handlers;
    const searchGlobal = handlers.get('search.global')!;
    expect(searchGlobal).toBeTruthy();

    // Seed rows through the real tables so the v3 FTS triggers populate the
    // virtual tables (no manual FTS insert).
    db.prepare("INSERT INTO chat_sessions (id, title, created_at, updated_at) VALUES ('s1', 't', '2026-01-01', '2026-01-01')").run();
    db.prepare("INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES ('m1', 's1', 'user', 'jarvis router search test', '2026-01-01')").run();

    const r = await searchGlobal({}, { query: 'router search' }) as { ok: boolean; results?: Array<{ table: string }> };
    expect(r.ok).toBe(true);
    expect(r.results).toHaveLength(1);
    expect(r.results![0].table).toBe('message');

    // An empty query returns [] instead of a FTS5 MATCH '' throw.
    const empty = await searchGlobal({}, { query: '' }) as { ok: boolean; results: unknown[] };
    expect(empty.results).toEqual([]);
  });
});

// M6 Task 9 (L31): agents.versions / agents.rollback channels. Both take a
// SINGLE object payload ({ id } / { id, versionId }) — the preload spreads
// positional args, so a two-arg call would leave the handler's destructure
// undefined and rollback would silently no-op (Task 8 review finding). The
// handlers return { ok, ... } / { ok, error }, never reject.
describe('IpcRouter agent version channels (L31)', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  it('lists versions and rolls back through the { id } / { id, versionId } object contract', async () => {
    const router = new IpcRouter(db);
    const daemon = { status: async () => ({ running: true }), restart: () => {} } as unknown as DaemonSupervisor;
    router.registerAll(daemon);
    const handlers = (router as unknown as { handlers: Map<string, (e: unknown, ...args: unknown[]) => unknown> }).handlers;
    const versions = handlers.get('agents.versions')!;
    const rollback = handlers.get('agents.rollback')!;
    expect(versions).toBeTruthy();
    expect(rollback).toBeTruthy();

    const agentStore = createAgentStore(db);
    const a = agentStore.create({ name: 'A', systemPrompt: 'v1', modelId: null, workspaceId: null });
    agentStore.update(a.id, { systemPrompt: 'v2' });

    // versions: { id } object payload -> { ok, versions }.
    const vres = await versions({}, { id: a.id }) as { ok: boolean; versions: Array<{ id: string }> };
    expect(vres.ok).toBe(true);
    expect(vres.versions).toHaveLength(1);

    // rollback: { id, versionId } object payload -> { ok: true }, config restored.
    const rres = await rollback({}, { id: a.id, versionId: vres.versions[0].id }) as { ok: boolean };
    expect(rres.ok).toBe(true);
    expect(agentStore.get(a.id).systemPrompt).toBe('v1');

    // Cross-agent guard: a version that does not belong to the payload agent id
    // is rejected (the rollback channel must not apply someone else's snapshot).
    const cross = await rollback({}, { id: 'other', versionId: vres.versions[0].id }) as { ok: boolean; error?: string };
    expect(cross.ok).toBe(false);
    expect(cross.error).toContain('not found for agent');

    // A malformed (missing) payload returns { ok:false } rather than rejecting.
    const bad = await rollback({}, undefined) as { ok: boolean; error?: string };
    expect(bad.ok).toBe(false);
  });

  it('returns { ok:false } for agents.versions with an unknown agent id (lax input validation)', async () => {
    const router = new IpcRouter(db);
    const daemon = { status: async () => ({ running: true }), restart: () => {} } as unknown as DaemonSupervisor;
    router.registerAll(daemon);
    const handlers = (router as unknown as { handlers: Map<string, (e: unknown, ...args: unknown[]) => unknown> }).handlers;
    const versions = handlers.get('agents.versions')!;
    const res = await versions({}, { id: 'nope' }) as { ok: boolean; versions?: unknown[]; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toContain('agent not found');
    expect(res.versions).toBeUndefined();
  });
});

// M6 Task 1 (L12) review fix: registerAll's persist subscription must not leak
// across router instances. Two routers on the shared singleton are registered
// against different dbs; after the first is disposed, posting on the singleton
// must only reach the live router's db.
describe('IpcRouter bus persist teardown (L12)', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  it('dispose() unsubscribes the persist subscription so routers do not leak', () => {
    const db2 = new Database(':memory:'); applyMigrations(db2);
    const daemon = { status: async () => ({ running: true }), restart: () => {} } as unknown as DaemonSupervisor;
    const router1 = new IpcRouter(db);
    router1.registerAll(daemon);
    router1.dispose();
    const router2 = new IpcRouter(db2);
    router2.registerAll(daemon);
    getMessageBus().post({ kind: 'log', from: 'a', to: '*', payload: { note: 1 } });
    const c1 = (db.prepare('SELECT COUNT(*) AS c FROM agent_messages').get() as { c: number }).c;
    const c2 = (db2.prepare('SELECT COUNT(*) AS c FROM agent_messages').get() as { c: number }).c;
    expect(c1).toBe(0);
    expect(c2).toBe(1);
  });
});

// M8 Task 3 (J5): audit channels read the audit_logs table the sqliteAuditSink
// writes; dialog.saveText persists export content through the native save dialog.
describe('IpcRouter audit + saveText channels (J5)', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  it('registers audit.list/audit.export over audit_logs and dialog.saveText', async () => {
    const router = new IpcRouter(db);
    const daemon = { status: async () => ({ running: true }), restart: () => {} } as unknown as DaemonSupervisor;
    router.registerAll(daemon);
    const handlers = (router as unknown as { handlers: Map<string, (e: unknown, ...args: unknown[]) => unknown> }).handlers;
    const list = handlers.get('audit.list')!;
    const exportAudit = handlers.get('audit.export')!;
    const saveText = handlers.get('dialog.saveText')!;
    expect(list).toBeTruthy();
    expect(exportAudit).toBeTruthy();
    expect(saveText).toBeTruthy();

    // Seed an audit row through the same sink the task path uses.
    const { sqliteAuditSink } = await import('../audit/sqliteAuditSink');
    sqliteAuditSink(db).write({ ts: 'x', kind: 'tool_call', actor: 'agent', action: 'read_file', target: 'a.txt', result: 'ok' });
    const rows = await list({}, { kind: 'tool_call' }) as Array<{ action: string; result: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('read_file');

    const csv = await exportAudit({}, { format: 'csv' }) as string;
    expect(csv).toContain('"tool_call"');

    // dialog.saveText: a canceled dialog returns { ok:false }; a chosen path
    // writes the content and returns { ok:true }.
    const { dialog } = await import('electron');
    const showSaveDialog = vi.mocked(dialog.showSaveDialog);
    showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: '' });
    expect(await saveText({}, { defaultName: 'audit.csv', content: 'x' })).toEqual({ ok: false });
    const out = join(tmpdir(), `jarvis-save-${Date.now()}.csv`);
    try {
      showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: out });
      expect(await saveText({}, { defaultName: 'audit.csv', content: 'hello' })).toEqual({ ok: true });
      expect(readFileSync(out, 'utf8')).toBe('hello');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

// M8 Task 10 (K6): canvas artifact channels registered on the router. The
// onDone capture path writes rows directly via the SAME createArtifactsIpc (in
// tasks.ts); these channels let the renderer CanvasView read them back.
describe('IpcRouter artifact channels (K6)', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  it('registers artifacts.list/artifacts.save over the task_artifacts table', async () => {
    const router = new IpcRouter(db);
    const daemon = { status: async () => ({ running: true }), restart: () => {} } as unknown as DaemonSupervisor;
    router.registerAll(daemon);
    const handlers = (router as unknown as { handlers: Map<string, (e: unknown, ...args: unknown[]) => unknown> }).handlers;
    const list = handlers.get('artifacts.list')!;
    const save = handlers.get('artifacts.save')!;
    expect(list).toBeTruthy();
    expect(save).toBeTruthy();

    const saved = await save({}, { taskId: 't1', kind: 'table', content: '| A |\n|---|\n| 1 |' }) as { id: string };
    expect(saved.id).toBeTruthy();
    const rows = await list({}, 't1') as Array<{ taskId: string; kind: string; content: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ taskId: 't1', kind: 'table', content: '| A |\n|---|\n| 1 |' });
  });
});

// M8 Task 4 (L18): backup channels registered on the router when a BackupService
// is threaded in, plus the app.relaunch channel (restore closes the db, so the
// renderer relaunches right after).
describe('IpcRouter backup channels (L18)', () => {
  let db: Database.Database;
  let dir: string;
  beforeEach(() => {
    db = new Database(':memory:');
    applyMigrations(db);
    dir = mkdtempSync(join(tmpdir(), 'jarvis-ipc-backup-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('registers backup.list/create/restore against a real BackupService and app.relaunch', async () => {
    const mainPath = join(dir, 'main.db');
    const main = new Database(mainPath);
    main.exec('CREATE TABLE t (v TEXT)');
    main.prepare("INSERT INTO t (v) VALUES ('x')").run();
    const backup = new BackupService(main, join(dir, 'backups'), mainPath);
    const router = new IpcRouter(db);
    const daemon = { status: async () => ({ running: true }), restart: () => {} } as unknown as DaemonSupervisor;
    router.registerAll(daemon, backup);
    const handlers = (router as unknown as { handlers: Map<string, (e: unknown, ...args: unknown[]) => unknown> }).handlers;
    const list = handlers.get('backup.list')!;
    const create = handlers.get('backup.create')!;
    const restore = handlers.get('backup.restore')!;
    const relaunch = handlers.get('app.relaunch')!;
    expect(list).toBeTruthy();
    expect(create).toBeTruthy();
    expect(restore).toBeTruthy();
    expect(relaunch).toBeTruthy();

    const created = await create({}) as { file: string };
    expect(existsSync(created.file)).toBe(true);
    expect((await list({}) as unknown[]).length).toBeGreaterThan(0);

    // restore copies the backup back over mainPath and closes main (the app is
    // expected to relaunch); the channel answers { ok, restart }.
    const res = await restore({}, created.file) as { ok: boolean; restart: boolean };
    expect(res.ok).toBe(true);
    expect(res.restart).toBe(true);

    const rl = relaunch({}) as { ok: boolean };
    expect(rl.ok).toBe(true);
  });

  it('rejects backup.create when search migration is blocked', async () => {
    const mainPath = join(dir, 'main.db');
    const main = new Database(mainPath);
    main.exec('CREATE TABLE t (v TEXT)');
    const backup = new BackupService(main, join(dir, 'backups'), mainPath);
    const router = new IpcRouter(db);
    const daemon = { status: async () => ({ running: true }), restart: () => {} } as unknown as DaemonSupervisor;
    router.registerAll(daemon, backup, { migrationBlocked: true });
    const handlers = (router as unknown as { handlers: Map<string, (e: unknown, ...args: unknown[]) => unknown> }).handlers;
    const create = handlers.get('backup.create')!;
    const res = await create({}) as { ok: false; error: string };
    expect(res.ok).toBe(false);
    expect(res.error).toBe('SEARCH_SECRET_MIGRATION_REQUIRED');
  });

  it('does not register backup.* when no BackupService is threaded in', () => {
    const router = new IpcRouter(db);
    const daemon = { status: async () => ({ running: true }), restart: () => {} } as unknown as DaemonSupervisor;
    router.registerAll(daemon);
    const handlers = (router as unknown as { handlers: Map<string, (e: unknown, ...args: unknown[]) => unknown> }).handlers;
    expect(handlers.get('backup.list')).toBeUndefined();
    expect(handlers.get('backup.create')).toBeUndefined();
    // app.relaunch is registered unconditionally.
    expect(handlers.get('app.relaunch')).toBeTruthy();
  });
});

// M8 Task 5 (L20): wipe.run is registered unconditionally and delegates to a
// real WipeService over the migrated db (keychain adapter walks providers
// api_key_refs; the single-active workspace is threaded as the workspace root).
describe('IpcRouter wipe channel (L20)', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  it('registers wipe.run and deletes allowlisted rows through the channel', async () => {
    const router = new IpcRouter(db);
    const daemon = { status: async () => ({ running: true }), restart: () => {} } as unknown as DaemonSupervisor;
    router.registerAll(daemon);
    const handlers = (router as unknown as { handlers: Map<string, (e: unknown, ...args: unknown[]) => unknown> }).handlers;
    const wipeRun = handlers.get('wipe.run')!;
    expect(wipeRun).toBeTruthy();

    db.prepare("INSERT INTO chat_sessions (id, title, created_at, updated_at) VALUES ('s1', 't', '2026-01-01', '2026-01-01')").run();
    db.prepare("INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES ('m1', 's1', 'user', 'x', '2026-01-01')").run();

    const { DEFAULT_WIPE_TABLES } = await import('@jarvis/core');
    const r = await wipeRun({}, { tables: DEFAULT_WIPE_TABLES, keychain: false, workspace: false }, 'DELETE') as {
      deleted: Record<string, number>; keychainDeleted: number; workspaceRemoved: boolean; vacuumed: boolean;
    };
    // The migrated schema has chat_messages.session_id ON DELETE CASCADE, so
    // wiping chat_sessions removes the message before the explicit DELETE FROM
    // chat_messages runs (reported changes 0). The wipe outcome is what matters:
    // both tables are empty and the session row is gone.
    expect(r.deleted.chat_sessions).toBe(1);
    expect(r.deleted.audit_logs).toBe(0);
    expect((db.prepare('SELECT COUNT(*) c FROM chat_messages').get() as { c: number }).c).toBe(0);
    expect((db.prepare('SELECT COUNT(*) c FROM chat_sessions').get() as { c: number }).c).toBe(0);
  });
});

// M8 Task 6 (C12): config.export / config.import channels registered on the
// router, plus dialog.pickPath / config.readPickedFile (SEC-02) that the
// ConfigImportExportView relies on.
describe('IpcRouter config channels (C12)', () => {
  let db: Database.Database;
  let dir: string;
  beforeEach(() => {
    db = new Database(':memory:');
    applyMigrations(db);
    dir = mkdtempSync(join(tmpdir(), 'jarvis-ipc-config-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const seed = () => {
    db.prepare("INSERT INTO providers (id, name, type, base_url, api_key_ref, created_at, updated_at) VALUES ('p1', 'P1', 'openai-compatible', 'https://old.example', 'keychain:p1', '2026-08-01', '2026-08-01')").run();
  };

  it('config.export serializes providers with schemaVersion 1.0.0-Preview and no plaintext keys', async () => {
    const router = new IpcRouter(db);
    const daemon = { status: async () => ({ running: true }), restart: () => {} } as unknown as DaemonSupervisor;
    router.registerAll(daemon);
    const handlers = (router as unknown as { handlers: Map<string, (e: unknown, ...args: unknown[]) => unknown> }).handlers;
    const exportCfg = handlers.get('config.export')!;
    seed();
    const out = await exportCfg({}, 'json') as string;
    expect(out).toContain('"schemaVersion": "1.0.0-Preview"');
    expect(out).toContain('"apiKeyRef": "keychain:p1"');
    expect(out).not.toContain('sk-');
    const yaml = await exportCfg({}, 'yaml') as string;
    expect(yaml).toContain('schemaVersion: 1.0.0-Preview');
  });

  it('rejects config.export when search migration is blocked', async () => {
    const router = new IpcRouter(db);
    const daemon = { status: async () => ({ running: true }), restart: () => {} } as unknown as DaemonSupervisor;
    router.registerAll(daemon, undefined, { migrationBlocked: true });
    const handlers = (router as unknown as { handlers: Map<string, (e: unknown, ...args: unknown[]) => unknown> }).handlers;
    const exportCfg = handlers.get('config.export')!;
    const res = await exportCfg({}, 'json') as { ok: false; error: string };
    expect(res.ok).toBe(false);
    expect(res.error).toBe('SEARCH_SECRET_MIGRATION_REQUIRED');
  });

  it('config.import applies skip/overwrite/merge and skips agents whose model is missing', async () => {
    const router = new IpcRouter(db);
    const daemon = { status: async () => ({ running: true }), restart: () => {} } as unknown as DaemonSupervisor;
    router.registerAll(daemon);
    const handlers = (router as unknown as { handlers: Map<string, (e: unknown, ...args: unknown[]) => unknown> }).handlers;
    const importCfg = handlers.get('config.import')!;

    // Merge: an existing provider keeps its apiKeyRef but picks up the new
    // baseUrl; a brand-new provider and a settings row are created.
    seed();
    const payload = JSON.stringify({
      schemaVersion: '1.0.0-Preview', exportedAt: '2026-08-05T00:00:00Z',
      providers: [
        { id: 'p1', name: 'P1', type: 'openai-compatible', baseUrl: 'https://new.example', apiKeyRef: '' },
        { id: 'p2', name: 'P2', type: 'anthropic-compatible', baseUrl: 'https://p2.example', apiKeyRef: 'keychain:p2' },
      ],
      models: [],
      agents: [{ id: 'a1', name: 'A1', slug: 'a-1', modelId: 'missing-model' }],
      settings: { 'concurrency.per_agent': 5 },
    });
    const res = await importCfg({}, payload, 'merge') as { ok: boolean; created: number; updated: number; skipped: number };
    expect(res.ok).toBe(true);
    expect(res.created).toBe(2);
    expect(res.updated).toBe(1);
    expect(res.skipped).toBe(1); // a1 references a model that does not exist

    const p1 = db.prepare('SELECT * FROM providers WHERE id = ?').get('p1') as { base_url: string; api_key_ref: string };
    expect(p1.base_url).toBe('https://new.example');
    expect(p1.api_key_ref).toBe('keychain:p1'); // empty apiKeyRef did not clobber
    const p2 = db.prepare('SELECT * FROM providers WHERE id = ?').get('p2') as { name: string; api_key_ref: string };
    expect(p2.name).toBe('P2');
    // DESK-18: imported apiKeyRef is ignored; bind canonical local ref only.
    expect(p2.api_key_ref).toBe('provider:p2:key');
    expect((db.prepare('SELECT COUNT(*) c FROM agents').get() as { c: number }).c).toBe(0);
    expect(db.prepare('SELECT value_json FROM settings WHERE key = ?').get('concurrency.per_agent')).toEqual({ value_json: '5' });
  });

  it('config.import rejects a null/empty payload cleanly (no ipcMain rejection)', async () => {
    const router = new IpcRouter(db);
    const daemon = { status: async () => ({ running: true }), restart: () => {} } as unknown as DaemonSupervisor;
    router.registerAll(daemon);
    const handlers = (router as unknown as { handlers: Map<string, (e: unknown, ...args: unknown[]) => unknown> }).handlers;
    const importCfg = handlers.get('config.import')!;
    // JSON `null` and an empty YAML document both parse to a null payload.
    const jsonNull = await importCfg({}, 'null', 'merge') as { ok: boolean; error?: string };
    expect(jsonNull.ok).toBe(false);
    expect(jsonNull.error).toContain('schemaVersion');
    const emptyYaml = await importCfg({}, '', 'merge') as { ok: boolean; error?: string };
    expect(emptyYaml.ok).toBe(false);
    expect(emptyYaml.error).toContain('schemaVersion');
  });

  it('config.import merge preserves an existing agent model_id when incoming omits modelId', async () => {
    const router = new IpcRouter(db);
    const daemon = { status: async () => ({ running: true }), restart: () => {} } as unknown as DaemonSupervisor;
    router.registerAll(daemon);
    const handlers = (router as unknown as { handlers: Map<string, (e: unknown, ...args: unknown[]) => unknown> }).handlers;
    const importCfg = handlers.get('config.import')!;
    db.prepare("INSERT INTO providers (id, name, type, base_url, api_key_ref, created_at, updated_at) VALUES ('p1', 'P1', 'openai-compatible', 'https://x', 'k', '2026-08-01', '2026-08-01')").run();
    db.prepare("INSERT INTO models (id, provider_id, model_id, name, created_at) VALUES ('m1', 'p1', 'gpt-test', 'M1', '2026-08-01')").run();
    db.prepare("INSERT INTO agents (id, name, slug, model_id, created_at, updated_at) VALUES ('a1', 'A1', 'a-1', 'm1', '2026-08-01', '2026-08-01')").run();
    const payload = JSON.stringify({
      schemaVersion: '1.0.0-Preview', exportedAt: '2026-08-05T00:00:00Z',
      providers: [], models: [],
      agents: [{ id: 'a1', name: 'A1 renamed', slug: 'a-1' }],
      settings: {},
    });
    const res = await importCfg({}, payload, 'merge') as { ok: boolean; skipped: number };
    expect(res.ok).toBe(true);
    expect(res.skipped).toBe(0);
    const a1 = db.prepare('SELECT * FROM agents WHERE id = ?').get('a1') as { name: string; model_id: string };
    expect(a1.name).toBe('A1 renamed');
    expect(a1.model_id).toBe('m1');
  });

  it('config.import skip leaves an existing provider untouched', async () => {
    const router = new IpcRouter(db);
    const daemon = { status: async () => ({ running: true }), restart: () => {} } as unknown as DaemonSupervisor;
    router.registerAll(daemon);
    const handlers = (router as unknown as { handlers: Map<string, (e: unknown, ...args: unknown[]) => unknown> }).handlers;
    const importCfg = handlers.get('config.import')!;
    seed();
    const payload = JSON.stringify({
      schemaVersion: '1.0.0-Preview', exportedAt: '2026-08-05T00:00:00Z',
      providers: [{ id: 'p1', name: 'Changed', type: 'openai-compatible', baseUrl: 'https://new.example', apiKeyRef: '' }],
      models: [], agents: [], settings: {},
    });
    const res = await importCfg({}, payload, 'skip') as { ok: boolean; skipped: number };
    expect(res.ok).toBe(true);
    expect(res.skipped).toBe(1);
    const p1 = db.prepare('SELECT * FROM providers WHERE id = ?').get('p1') as { base_url: string };
    expect(p1.base_url).toBe('https://old.example');
  });

  it('config.readPickedFile returns text via capability and { ok:false } on failure', async () => {
    const router = new IpcRouter(db);
    const daemon = { status: async () => ({ running: true }), restart: () => {} } as unknown as DaemonSupervisor;
    router.registerAll(daemon);
    const handlers = (router as unknown as { handlers: Map<string, (e: unknown, ...args: unknown[]) => unknown> }).handlers;
    const pickPath = handlers.get('dialog.pickPath')!;
    const readPicked = handlers.get('config.readPickedFile')!;
    const { dialog } = await import('electron');
    const showOpenDialog = vi.mocked(dialog.showOpenDialog);
    const file = join(dir, 'config.json');
    writeFileSync(file, '{"schemaVersion": 12}', 'utf8');
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [file] });
    const caps = await pickPath({ sender: { id: 42 } }, { purpose: 'config-import' }) as Array<{ token: string }>;
    expect(await readPicked({ sender: { id: 42 } }, { capability: caps[0]!.token })).toBe('{"schemaVersion": 12}');
    const missing = await readPicked({ sender: { id: 42 } }, { capability: 'unknown-token' }) as { ok: boolean; error: string };
    expect(missing.ok).toBe(false);
    expect(missing.error).toBeTruthy();
  });

  it('does not register dialog.openFile (SEC-02: renderer uses dialog.pickPath)', async () => {
    const router = new IpcRouter(db);
    const daemon = { status: async () => ({ running: true }), restart: () => {} } as unknown as DaemonSupervisor;
    router.registerAll(daemon);
    const handlers = (router as unknown as { handlers: Map<string, (e: unknown, ...args: unknown[]) => unknown> }).handlers;
    expect(handlers.has('dialog.openFile')).toBe(false);
  });
});

describe('IpcRouter capability revoke', () => {
  let db: Database.Database;
  let dir: string;
  beforeEach(() => {
    db = new Database(':memory:');
    applyMigrations(db);
    dir = mkdtempSync(join(tmpdir(), 'jarvis-ipc-revoke-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('attachMainWindowRevoke clears capabilities on window close after late attach (bootstrap order)', async () => {
    const router = new IpcRouter(db);
    const daemon = { status: async () => ({ running: true }), restart: () => {} } as unknown as DaemonSupervisor;
    router.registerAll(daemon);
    router.listen();
    const closedCbs: Array<() => void> = [];
    const win = {
      isDestroyed: () => false,
      on: (event: string, cb: () => void) => { if (event === 'closed') closedCbs.push(cb); },
      webContents: { id: 99, on: vi.fn() },
    };
    router.attachMainWindowRevoke(win as never);
    const handlers = (router as unknown as { handlers: Map<string, (e: unknown, ...args: unknown[]) => unknown> }).handlers;
    const pickPath = handlers.get('dialog.pickPath')!;
    const readPicked = handlers.get('config.readPickedFile')!;
    const { dialog } = await import('electron');
    const showOpenDialog = vi.mocked(dialog.showOpenDialog);
    const file = join(dir, 'config.json');
    writeFileSync(file, '{"schemaVersion": 12}', 'utf8');
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [file] });
    const caps = await pickPath({ sender: { id: 99 } }, { purpose: 'config-import' }) as Array<{ token: string }>;
    expect(await readPicked({ sender: { id: 99 } }, { capability: caps[0]!.token })).toBe('{"schemaVersion": 12}');
    for (const cb of closedCbs) cb();
    const revoked = await readPicked({ sender: { id: 99 } }, { capability: caps[0]!.token }) as { ok: boolean; error: string };
    expect(revoked.ok).toBe(false);
    expect(revoked.error).toContain('PATH_CAPABILITY');
  });
});

describe('IpcRouter trusted IPC enforcement', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  it('wraps every ipcMain handler with trusted main-frame enforcement', async () => {
    const { ipcMain } = await import('electron');
    const mainFrame = { url: 'file:///app/out/renderer/index.html' };
    const webContents = { id: 1, mainFrame };
    const win = { webContents };
    const router = new IpcRouter(db, {
      getMainWindow: () => win as never,
      rendererRoot: '/app/out/renderer',
    });
    router.register('probe', () => 'ok');
    router.listen();
    const wrapped = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === 'probe')![1];
    await expect(wrapped({ sender: { id: 2 }, senderFrame: mainFrame } as never)).rejects.toThrow('IPC_UNTRUSTED_WINDOW');
    await expect(wrapped({ sender: webContents, senderFrame: { url: mainFrame.url } } as never)).rejects.toThrow('IPC_UNTRUSTED_FRAME');
    await expect(wrapped({ sender: webContents, senderFrame: mainFrame } as never)).resolves.toBe('ok');
  });

  it('rejects IPC when getMainWindow is unset', async () => {
    const { ipcMain } = await import('electron');
    const mainFrame = { url: 'file:///app/out/renderer/index.html' };
    const webContents = { id: 1, mainFrame };
    const router = new IpcRouter(db, { rendererRoot: '/app/out/renderer' });
    router.register('probe', () => 'ok');
    router.listen();
    const wrapped = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === 'probe')![1];
    await expect(wrapped({ sender: webContents, senderFrame: mainFrame } as never)).rejects.toThrow('IPC_UNTRUSTED_WINDOW');
  });
});
