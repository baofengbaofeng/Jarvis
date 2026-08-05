import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '../db/migrations';
import { IpcRouter } from './IpcRouter';
import { createProviderStore } from './providers';
import type { DaemonSupervisor } from '../daemon/DaemonSupervisor';

// IpcRouter imports electron at runtime; stub it so the router can be
// constructed under vitest without a real Electron main process.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null }
}));

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
