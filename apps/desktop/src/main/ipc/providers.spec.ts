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
    const p = await store.create({ name: 'My-OpenAI', type: 'openai-compatible', baseUrl: 'https://api.openai.com', apiKey: 'sk-test' });
    expect(p.apiKeyRef).toBe(`provider:${p.id}:key`);
    expect(store.list().length).toBe(1);
  });

  it('adds model to provider', async () => {
    const store = createProviderStore(db, secrets);
    const p = await store.create({ name: 'P', type: 'openai-compatible', baseUrl: 'https://x.com', apiKey: 'sk-t' });
    const m = store.addModel(p.id, { modelId: 'custom-1', name: 'My-custom-model' });
    expect(m.providerId).toBe(p.id);
    expect(m.contextTokens).toBeNull();
    expect(store.listModels(p.id).length).toBe(1);
  });

  it('toggles provider/model enabled and lists only selectable models', async () => {
    const store = createProviderStore(db, secrets);
    const p = await store.create({ name: 'P', type: 'openai-compatible', baseUrl: 'https://x.com', apiKey: 'sk-t' });
    expect(p.enabled).toBe(true);
    const m = store.addModel(p.id, { modelId: 'm1', name: 'M1' });
    expect(m.enabled).toBe(true);
    expect(store.listSelectableModels()).toHaveLength(1);

    store.setModelEnabled(m.id, false);
    expect(store.listModels(p.id)[0]?.enabled).toBe(false);
    expect(store.listSelectableModels()).toHaveLength(0);

    store.setModelEnabled(m.id, true);
    store.setEnabled(p.id, false);
    expect(store.list().find((x) => x.id === p.id)?.enabled).toBe(false);
    expect(store.listSelectableModels()).toHaveLength(0);
  });

  it('refuses to delete a provider that still has models', async () => {
    const store = createProviderStore(db, secrets);
    const p = await store.create({ name: 'P', type: 'openai-compatible', baseUrl: 'https://x.com', apiKey: 'sk-t' });
    store.addModel(p.id, { modelId: 'm1', name: 'M1' });
    await expect(store.remove(p.id)).rejects.toThrow('PROVIDER_HAS_MODELS');
    store.removeModel(store.listModels(p.id)[0]!.id);
    await store.remove(p.id);
    expect(store.list()).toHaveLength(0);
  });

  it('stores optional context tokens and removes model (clearing agent refs)', async () => {
    const store = createProviderStore(db, secrets);
    const p = await store.create({ name: 'P', type: 'openai-compatible', baseUrl: 'https://x.com', apiKey: 'sk-t' });
    const m = store.addModel(p.id, { modelId: 'm1', name: 'M1', contextTokens: 128_000 });
    expect(m.contextTokens).toBe(128_000);
    expect(store.listModels(p.id)[0]?.contextTokens).toBe(128_000);
    expect(() => store.addModel(p.id, { modelId: 'm2', name: 'M2', contextTokens: 1.5 })).toThrow(
      'PROVIDER_MODEL_CONTEXT_INVALID',
    );
    expect(() => store.addModel(p.id, { modelId: 'm2', name: 'M2', contextTokens: 0 })).toThrow(
      'PROVIDER_MODEL_CONTEXT_INVALID',
    );

    db.prepare(
      `INSERT INTO agents (id, name, slug, description, system_prompt, model_id, workspace_id, context_budget_tokens, plan_only, env_vars_json, cli_args_json, created_at, updated_at)
       VALUES (?, ?, ?, '', '', ?, NULL, 128000, 0, '{}', '[]', ?, ?)`,
    ).run('a1', 'Agent', 'agent', m.id, new Date().toISOString(), new Date().toISOString());

    store.removeModel(m.id);
    expect(store.listModels(p.id)).toEqual([]);
    const agent = db.prepare('SELECT model_id FROM agents WHERE id = ?').get('a1') as { model_id: string | null };
    expect(agent.model_id).toBeNull();
  });

  it('accepts http URLs on persist', async () => {
    const store = createProviderStore(db, secrets);
    const p = await store.create({
      name: 'Http',
      type: 'openai-compatible',
      baseUrl: 'http://api.openai.com',
      apiKey: 'secret',
    });
    expect(p.baseUrl).toBe('http://api.openai.com');
  });

  it('rejects addresses without http(s) prefix before keychain or db writes', async () => {
    const set = vi.fn();
    const store = createProviderStore(db, { set, get: async () => null, delete: async () => {} });
    await expect(store.create({ name: 'P', type: 'openai-compatible', baseUrl: 'api.openai.com', apiKey: 'secret' }))
      .rejects.toThrow('URL_PROTOCOL_REQUIRED');
    expect(set).not.toHaveBeenCalled();
    expect(store.list()).toEqual([]);
  });

  it('rejects invalid provider names before keychain or db writes', async () => {
    const set = vi.fn();
    const store = createProviderStore(db, { set, get: async () => null, delete: async () => {} });
    await expect(
      store.create({ name: 'GPT-4!', type: 'openai-compatible', baseUrl: 'https://x.com', apiKey: 'sk-t' }),
    ).rejects.toThrow('PROVIDER_NAME_INVALID');
    expect(set).not.toHaveBeenCalled();
  });

  it('rejects invalid model id or display name', async () => {
    const store = createProviderStore(db, secrets);
    const p = await store.create({ name: 'P', type: 'openai-compatible', baseUrl: 'https://x.com', apiKey: 'sk-t' });
    expect(() => store.addModel(p.id, { modelId: 'gpt.4', name: 'Ok' })).toThrow('PROVIDER_MODEL_ID_INVALID');
    expect(() => store.addModel(p.id, { modelId: 'gpt-4', name: 'Bad name!' })).toThrow('PROVIDER_MODEL_NAME_INVALID');
  });

  it('persists https loopback URLs (DNS policy is enforced on outbound requests)', async () => {
    const store = createProviderStore(db, secrets);
    const p = await store.create({ name: 'Local', type: 'openai-compatible', baseUrl: 'https://127.0.0.1:8443/v1', apiKey: 'sk-t' });
    expect(p.baseUrl).toBe('https://127.0.0.1:8443/v1');
    expect(store.list()).toHaveLength(1);
  });

  it('persists anthropic-compatible type as selected', async () => {
    const store = createProviderStore(db, secrets);
    const p = await store.create({
      name: 'DeepSeek',
      type: 'anthropic-compatible',
      baseUrl: 'https://api.deepseek.com/anthropic',
      apiKey: 'sk-t',
    });
    expect(p.type).toBe('anthropic-compatible');
    expect(store.list()[0]?.type).toBe('anthropic-compatible');
  });

  it('rejects invalid provider type before keychain or db writes', async () => {
    const set = vi.fn();
    const store = createProviderStore(db, { set, get: async () => null, delete: async () => {} });
    await expect(
      store.create({
        name: 'P',
        type: 'openai' as 'openai-compatible',
        baseUrl: 'https://x.com',
        apiKey: 'secret',
      }),
    ).rejects.toThrow('PROVIDER_TYPE_INVALID');
    expect(set).not.toHaveBeenCalled();
    expect(store.list()).toEqual([]);
  });

  it('rejects duplicate provider names (trimmed) before keychain or db writes', async () => {
    const set = vi.fn();
    const store = createProviderStore(db, { set, get: async () => null, delete: async () => {} });
    await store.create({ name: 'DeepSeek', type: 'openai-compatible', baseUrl: 'https://a.com', apiKey: 'sk-1' });
    set.mockClear();
    await expect(
      store.create({ name: '  DeepSeek  ', type: 'openai-compatible', baseUrl: 'https://b.com', apiKey: 'sk-2' }),
    ).rejects.toThrow('PROVIDER_NAME_DUPLICATE');
    expect(set).not.toHaveBeenCalled();
    expect(store.list()).toHaveLength(1);
  });

  it('rejects overlong name / baseUrl / apiKey before keychain or db writes', async () => {
    const set = vi.fn();
    const store = createProviderStore(db, { set, get: async () => null, delete: async () => {} });
    await expect(
      store.create({
        name: 'n'.repeat(65),
        type: 'openai-compatible',
        baseUrl: 'https://x.com',
        apiKey: 'sk-t',
      }),
    ).rejects.toThrow('PROVIDER_NAME_TOO_LONG');
    await expect(
      store.create({
        name: 'Ok',
        type: 'openai-compatible',
        baseUrl: `https://x.com/${'p'.repeat(2048)}`,
        apiKey: 'sk-t',
      }),
    ).rejects.toThrow('PROVIDER_BASE_URL_TOO_LONG');
    await expect(
      store.create({
        name: 'Ok',
        type: 'openai-compatible',
        baseUrl: 'https://x.com',
        apiKey: 'k'.repeat(513),
      }),
    ).rejects.toThrow('PROVIDER_API_KEY_TOO_LONG');
    expect(set).not.toHaveBeenCalled();
    expect(store.list()).toEqual([]);
  });
});
