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
