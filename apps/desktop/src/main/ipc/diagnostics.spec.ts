import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../db/migrations';
import { testProviderConnectivity, runDiagnostics } from './diagnostics';
import type { SecureStorage } from '../secrets/SecureStorage';

// Deterministic SSE response used by the openai-compatible adapter mock.
function mockFetch(lines: string[]) {
  const body = lines.join('\n') + '\n';
  return async () => ({
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(c) {
        const enc = new TextEncoder();
        c.enqueue(enc.encode(body));
        c.close();
      }
    })
  }) as unknown as Response;
}

function insertProvider(db: Database.Database, overrides: Record<string, string> = {}) {
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO providers (id, name, type, base_url, api_key_ref, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
  ).run(
    overrides.id ?? 'p1',
    overrides.name ?? 'P1',
    overrides.type ?? 'openai-compatible',
    overrides.baseUrl ?? 'https://api.example.com',
    overrides.apiKeyRef ?? 'provider:p1:key',
    now, now
  );
}

function insertModel(db: Database.Database, providerId: string, modelId: string) {
  db.prepare('INSERT INTO models (id, provider_id, model_id, name, created_at) VALUES (?,?,?,?,?)')
    .run(`m-${providerId}`, providerId, modelId, modelId, new Date().toISOString());
}

describe('testProviderConnectivity', () => {
  let db: Database.Database;
  // Return a key for every ref except the special 'provider:no-key:key' ref.
  const secrets = {
    set: async () => {},
    get: async (key: string) => (key === 'provider:no-key:key' ? null : 'sk-test'),
    delete: async () => {}
  } as unknown as SecureStorage;

  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('reports provider not found for an unknown id', async () => {
    const r = await testProviderConnectivity(db, secrets, 'nope', 'model-x');
    expect(r).toEqual({ ok: false, latencyMs: 0, detail: 'provider not found' });
  });

  it('reports missing api key when the keychain returns null', async () => {
    insertProvider(db, { id: 'p-no-key', apiKeyRef: 'provider:no-key:key' });
    const r = await testProviderConnectivity(db, secrets, 'p-no-key', 'model-x');
    expect(r).toEqual({ ok: false, latencyMs: 0, detail: 'missing api key' });
  });

  it('reports ok when the provider adapter completes', async () => {
    insertProvider(db);
    const r = await testProviderConnectivity(db, secrets, 'p1', 'model-x', {
      fetchImpl: mockFetch(['data: {"choices":[{"delta":{"content":"p"}}]}', 'data: [DONE]'])
    });
    expect(r.ok).toBe(true);
    expect(r.detail).toBe('ok');
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('surfaces adapter errors in detail', async () => {
    insertProvider(db);
    const r = await testProviderConnectivity(db, secrets, 'p1', 'model-x', {
      fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'unauthorized' }) as unknown as Response
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('openai http 401');
  });
});

describe('runDiagnostics', () => {
  let db: Database.Database;
  const secrets = {
    set: async () => {},
    get: async () => 'sk-test',
    delete: async () => {}
  } as unknown as SecureStorage;

  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns a report with env info and no items when there are no providers', async () => {
    const report = await runDiagnostics(db, secrets);
    expect(report.env.nodeVersion).toBeTruthy();
    expect(report.checkedAt).toBeTruthy();
    expect(report.items).toEqual([]);
  });

  it('flags a provider that has no models', async () => {
    insertProvider(db, { id: 'p-no-models' });
    const report = await runDiagnostics(db, secrets);
    expect(report.items).toEqual([{ id: 'provider:p-no-models', ok: false, detail: 'no models' }]);
  });

  it('aggregates env and per-provider connectivity items', async () => {
    insertProvider(db, { id: 'p-m' });
    insertModel(db, 'p-m', 'model-1');
    // runDiagnostics does not forward an injected fetch, so stub the global
    // fetch used by the adapter for this deterministic success path.
    vi.stubGlobal('fetch', mockFetch(['data: {"choices":[{"delta":{"content":"p"}}]}', 'data: [DONE]']));
    const report = await runDiagnostics(db, secrets);
    expect(report.items).toHaveLength(1);
    expect(report.items[0].id).toBe('provider:p-m');
    expect(report.items[0].ok).toBe(true);
    expect(report.items[0].detail).toContain('ok');
  });
});
