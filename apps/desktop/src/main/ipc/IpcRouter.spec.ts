import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
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
