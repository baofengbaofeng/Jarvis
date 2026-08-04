import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Provider, Model } from '@jarvis/protocol';
import type { SecureStorage } from '../secrets/SecureStorage';

export interface ProviderInput { name: string; type: 'openai-compatible' | 'anthropic-compatible'; baseUrl: string; apiKey: string }
export interface ModelInput { modelId: string; name: string }

export function createProviderStore(db: Database.Database, secrets: Pick<SecureStorage, 'set' | 'get' | 'delete'>) {
  const now = () => new Date().toISOString();
  const rowToProvider = (r: Record<string, unknown>): Provider => ({
    id: r.id as string, name: r.name as string, type: r.type as Provider['type'],
    baseUrl: r.base_url as string, apiKeyRef: r.api_key_ref as string,
    createdAt: r.created_at as string, updatedAt: r.updated_at as string
  });

  return {
    list(): Provider[] {
      return (db.prepare('SELECT * FROM providers ORDER BY created_at').all() as Record<string, unknown>[]).map(rowToProvider);
    },
    async create(input: ProviderInput): Promise<Provider> {
      const id = randomUUID();
      const ref = `provider:${id}:key`;
      db.prepare('INSERT INTO providers (id, name, type, base_url, api_key_ref, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
        .run(id, input.name, input.type, input.baseUrl, ref, now(), now());
      await secrets.set(ref, input.apiKey);
      return this.list().find(p => p.id === id)!;
    },
    async update(id: string, patch: Partial<ProviderInput>): Promise<Provider> {
      const cur = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      if (!cur) throw new Error(`provider not found: ${id}`);
      const name = patch.name ?? cur.name as string;
      const type = patch.type ?? cur.type as Provider['type'];
      const baseUrl = patch.baseUrl ?? cur.base_url as string;
      db.prepare('UPDATE providers SET name=?, type=?, base_url=?, updated_at=? WHERE id=?').run(name, type, baseUrl, now(), id);
      if (patch.apiKey !== undefined) await secrets.set(`provider:${id}:key`, patch.apiKey);
      return rowToProvider(db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as Record<string, unknown>);
    },
    async remove(id: string): Promise<void> {
      db.prepare('DELETE FROM providers WHERE id = ?').run(id);
      await secrets.delete(`provider:${id}:key`);
    },
    listModels(providerId: string): Model[] {
      return (db.prepare('SELECT * FROM models WHERE provider_id = ? ORDER BY created_at').all(providerId) as Record<string, unknown>[]).map(r => ({
        id: r.id as string, providerId: r.provider_id as string, modelId: r.model_id as string,
        name: r.name as string, createdAt: r.created_at as string
      }));
    },
    addModel(providerId: string, input: ModelInput): Model {
      const id = randomUUID();
      db.prepare('INSERT INTO models (id, provider_id, model_id, name, created_at) VALUES (?,?,?,?,?)').run(id, providerId, input.modelId, input.name, now());
      return this.listModels(providerId).find(m => m.id === id)!;
    }
  };
}
