import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../db/migrations';
import { createProviderStore } from './providers';

describe('provider store', () => {
  let db: Database.Database;
  const secrets = { set: async () => {}, get: async () => null, delete: async () => {} };

  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  it('creates and lists provider with key ref', async () => {
    const store = createProviderStore(db, secrets);
    const p = await store.create({ name: 'My OpenAI', type: 'openai-compatible', baseUrl: 'https://api.openai.com', apiKey: 'sk-test' });
    expect(p.apiKeyRef).toBe(`provider:${p.id}:key`);
    expect(store.list().length).toBe(1);
  });

  it('adds model to provider', async () => {
    const store = createProviderStore(db, secrets);
    const p = await store.create({ name: 'P', type: 'openai-compatible', baseUrl: 'https://x.com', apiKey: 'sk-t' });
    const m = store.addModel(p.id, { modelId: 'custom-1', name: 'My custom model' });
    expect(m.providerId).toBe(p.id);
    expect(store.listModels(p.id).length).toBe(1);
  });

  it('rejects a provider URL before keychain or db writes', async () => {
    const set = vi.fn();
    const store = createProviderStore(db, { set, get: async () => null, delete: async () => {} }, {
      assertAllowedUrl: async () => { throw new Error('URL_PRIVATE_ADDRESS'); },
    });
    await expect(store.create({ name: 'P', type: 'openai-compatible', baseUrl: 'https://127.0.0.1', apiKey: 'secret' }))
      .rejects.toThrow('URL_PRIVATE_ADDRESS');
    expect(set).not.toHaveBeenCalled();
    expect(store.list()).toEqual([]);
  });
});
