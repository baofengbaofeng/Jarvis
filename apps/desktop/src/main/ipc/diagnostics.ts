import type Database from 'better-sqlite3';
import type { Provider } from '@jarvis/protocol';
import type { SecureStorage } from '../secrets/SecureStorage';
import { createAdapter } from '@jarvis/core';
import { collectEnvInfo } from '../diagnostics/env';

export async function testProviderConnectivity(db: Database.Database, secrets: SecureStorage, providerId: string, modelId: string, deps: { fetchImpl?: typeof fetch } = {}): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
  const p = db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId) as Record<string, unknown> | undefined;
  if (!p) return { ok: false, latencyMs: 0, detail: 'provider not found' };
  const apiKey = await secrets.get(p.api_key_ref as string);
  if (!apiKey) return { ok: false, latencyMs: 0, detail: 'missing api key' };
  const adapter = createAdapter(p.type as Provider['type'], deps);
  const start = Date.now();
  try {
    await adapter.chat({
      provider: { id: p.id as string, name: p.name as string, type: p.type as Provider['type'], baseUrl: p.base_url as string, apiKeyRef: p.api_key_ref as string, createdAt: '', updatedAt: '' },
      modelId, messages: [{ role: 'user', content: 'ping' }], stream: false, maxTokens: 1
    }, { apiKey, onChunk: () => {} });
    return { ok: true, latencyMs: Date.now() - start, detail: 'ok' };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - start, detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function runDiagnostics(db: Database.Database, secrets: SecureStorage): Promise<import('@jarvis/protocol').DiagnosticsReport> {
  const env = await collectEnvInfo();
  const providers = (db.prepare('SELECT * FROM providers').all() as Record<string, unknown>[]).map(r => ({
    id: r.id as string, type: r.type as Provider['type'], apiKeyRef: r.api_key_ref as string, name: r.name as string, baseUrl: r.base_url as string, createdAt: r.created_at as string, updatedAt: r.updated_at as string
  }));
  const items = [];
  for (const p of providers) {
    const models = db.prepare('SELECT model_id FROM models WHERE provider_id = ?').all(p.id) as Array<{ model_id: string }>;
    if (models.length === 0) { items.push({ id: `provider:${p.id}`, ok: false, detail: 'no models' }); continue; }
    const r = await testProviderConnectivity(db, secrets, p.id, models[0].model_id);
    items.push({ id: `provider:${p.id}`, ok: r.ok, detail: `${r.detail} (${r.latencyMs}ms)` });
  }
  return { env, checkedAt: new Date().toISOString(), items };
}
