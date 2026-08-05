import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '../db/migrations';
import { IpcRouter } from './IpcRouter';
import { createProviderStore } from './providers';
import { createAgentStore } from './agents';
import { getMessageBus, __resetBusForTests } from './squad';
import type { DaemonSupervisor } from '../daemon/DaemonSupervisor';

// IpcRouter imports electron at runtime; stub it so the router can be
// constructed under vitest without a real Electron main process.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null }
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
