import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  PROVIDER_FIELD_MAX,
  isValidProviderModelId,
  isValidProviderModelName,
  isValidProviderName,
  type Provider,
  type Model,
  type SelectableModel,
} from '@jarvis/protocol';
import type { SecureStorage } from '../secrets/SecureStorage';
import { assertProviderBaseUrlShape } from './providerUrl';

export interface ProviderInput { name: string; type: 'openai-compatible' | 'anthropic-compatible'; baseUrl: string; apiKey: string }
export interface ModelInput {
  modelId: string;
  name: string;
  /** Absolute context window in tokens; omit/null = unset. */
  contextTokens?: number | null;
  maxOutputTokens?: number | null;
  supportsTools?: boolean;
  supportsImages?: boolean;
}

export type ModelUpdateInput = {
  name?: string;
  contextTokens?: number | null;
  maxOutputTokens?: number | null;
  supportsTools?: boolean;
  supportsImages?: boolean;
};

const PROVIDER_TYPES = new Set<ProviderInput['type']>(['openai-compatible', 'anthropic-compatible']);

export interface ProviderStoreDeps {
  /** @deprecated Persist uses structural HTTPS checks only; outbound SafeUrlPolicy still applies on requests. */
  assertAllowedUrl?: (url: string) => Promise<void>;
}

function assertProviderType(type: unknown): asserts type is ProviderInput['type'] {
  if (typeof type !== 'string' || !PROVIDER_TYPES.has(type as ProviderInput['type'])) {
    throw new Error('PROVIDER_TYPE_INVALID');
  }
}

function assertProviderFieldLengths(input: { name: string; baseUrl: string; apiKey?: string }) {
  if (input.name.length > PROVIDER_FIELD_MAX.name) throw new Error('PROVIDER_NAME_TOO_LONG');
  if (input.baseUrl.length > PROVIDER_FIELD_MAX.baseUrl) throw new Error('PROVIDER_BASE_URL_TOO_LONG');
  if (input.apiKey !== undefined && input.apiKey.length > PROVIDER_FIELD_MAX.apiKey) {
    throw new Error('PROVIDER_API_KEY_TOO_LONG');
  }
}

function asEnabled(value: unknown): boolean {
  return Number(value ?? 1) === 1;
}

function normalizeMaxOutput(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (
    typeof value !== 'number'
    || !Number.isInteger(value)
    || value <= 0
    || value > PROVIDER_FIELD_MAX.contextTokens
  ) {
    throw new Error('PROVIDER_MODEL_MAX_OUTPUT_INVALID');
  }
  return value;
}

function normalizeContextTokens(value: unknown): number | null {
  if (value == null) return null;
  if (
    typeof value !== 'number'
    || !Number.isInteger(value)
    || value <= 0
    || value > PROVIDER_FIELD_MAX.contextTokens
  ) {
    throw new Error('PROVIDER_MODEL_CONTEXT_INVALID');
  }
  return value;
}

export function createProviderStore(
  db: Database.Database,
  secrets: Pick<SecureStorage, 'set' | 'get' | 'delete'>,
  _deps: ProviderStoreDeps = {},
) {
  const now = () => new Date().toISOString();
  const rowToProvider = (r: Record<string, unknown>): Provider => ({
    id: r.id as string,
    name: r.name as string,
    type: r.type as Provider['type'],
    baseUrl: r.base_url as string,
    apiKeyRef: r.api_key_ref as string,
    enabled: asEnabled(r.enabled),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  });

  const rowToModel = (r: Record<string, unknown>): Model => ({
    id: r.id as string,
    providerId: r.provider_id as string,
    modelId: r.model_id as string,
    name: r.name as string,
    contextTokens: (r.context_tokens as number | null | undefined) ?? null,
    maxOutputTokens: (r.max_output_tokens as number | null | undefined) ?? null,
    supportsTools: Number(r.supports_tools ?? 1) === 1,
    supportsImages: Number(r.supports_images ?? 0) === 1,
    enabled: asEnabled(r.enabled),
    createdAt: r.created_at as string,
  });

  const validatePersistUrl = (baseUrl: string) => {
    // DNS / private-IP checks belong on outbound requests (SafeUrlPolicy), not on save —
    // otherwise flaky DNS or offline machines cannot create a Provider at all.
    assertProviderBaseUrlShape(baseUrl);
  };

  const assertNameUnique = (name: string, excludeId?: string) => {
    const row = excludeId
      ? db.prepare('SELECT id FROM providers WHERE name = ? AND id != ?').get(name, excludeId)
      : db.prepare('SELECT id FROM providers WHERE name = ?').get(name);
    if (row) throw new Error('PROVIDER_NAME_DUPLICATE');
  };

  return {
    list(): Provider[] {
      return (db.prepare('SELECT * FROM providers ORDER BY created_at').all() as Record<string, unknown>[]).map(rowToProvider);
    },
    async create(input: ProviderInput): Promise<Provider> {
      const name = input.name.trim();
      if (!name) throw new Error('PROVIDER_NAME_REQUIRED');
      if (!isValidProviderName(name)) throw new Error('PROVIDER_NAME_INVALID');
      const baseUrl = input.baseUrl.trim();
      const apiKey = input.apiKey.trim();
      if (!apiKey) throw new Error('PROVIDER_API_KEY_REQUIRED');
      assertProviderFieldLengths({ name, baseUrl, apiKey });
      assertNameUnique(name);
      assertProviderType(input.type);
      validatePersistUrl(baseUrl);
      const id = randomUUID();
      const ref = `provider:${id}:key`;
      // Write the keychain entry FIRST so a keychain failure leaves no dangling api_key_ref row.
      await secrets.set(ref, apiKey);
      db.prepare('INSERT INTO providers (id, name, type, base_url, api_key_ref, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
        .run(id, name, input.type, baseUrl, ref, now(), now());
      return this.list().find(p => p.id === id)!;
    },
    async update(id: string, patch: Partial<ProviderInput>): Promise<Provider> {
      const cur = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      if (!cur) throw new Error(`provider not found: ${id}`);
      const baseUrl = (patch.baseUrl ?? cur.base_url as string).trim();
      const name = (patch.name ?? cur.name as string).trim();
      if (!name) throw new Error('PROVIDER_NAME_REQUIRED');
      if (!isValidProviderName(name)) throw new Error('PROVIDER_NAME_INVALID');
      const nextApiKey = patch.apiKey !== undefined ? patch.apiKey.trim() : undefined;
      if (patch.apiKey !== undefined && !nextApiKey) throw new Error('PROVIDER_API_KEY_REQUIRED');
      assertProviderFieldLengths({ name, baseUrl, apiKey: nextApiKey });
      validatePersistUrl(baseUrl);
      if (nextApiKey !== undefined) await secrets.set(`provider:${id}:key`, nextApiKey);
      assertNameUnique(name, id);
      const type = patch.type ?? cur.type as Provider['type'];
      assertProviderType(type);
      db.prepare('UPDATE providers SET name=?, type=?, base_url=?, updated_at=? WHERE id=?').run(name, type, baseUrl, now(), id);
      return rowToProvider(db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as Record<string, unknown>);
    },
    setEnabled(id: string, enabled: boolean): Provider {
      const cur = db.prepare('SELECT id FROM providers WHERE id = ?').get(id);
      if (!cur) throw new Error(`provider not found: ${id}`);
      db.prepare('UPDATE providers SET enabled=?, updated_at=? WHERE id=?').run(enabled ? 1 : 0, now(), id);
      return rowToProvider(db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as Record<string, unknown>);
    },
    async remove(id: string): Promise<void> {
      const modelCount = (db.prepare('SELECT COUNT(*) AS n FROM models WHERE provider_id = ?').get(id) as { n: number }).n;
      if (modelCount > 0) throw new Error('PROVIDER_HAS_MODELS');
      db.prepare('DELETE FROM providers WHERE id = ?').run(id);
      await secrets.delete(`provider:${id}:key`);
    },
    listModels(providerId: string): Model[] {
      return (db.prepare('SELECT * FROM models WHERE provider_id = ? ORDER BY created_at').all(providerId) as Record<string, unknown>[]).map(rowToModel);
    },
    listSelectableModels(): SelectableModel[] {
      const rows = db.prepare(`
        SELECT m.id, m.provider_id, m.model_id, m.name, m.context_tokens,
               m.max_output_tokens, m.supports_tools, m.supports_images,
               p.name AS provider_name
        FROM models m
        JOIN providers p ON p.id = m.provider_id
        WHERE m.enabled = 1 AND p.enabled = 1
        ORDER BY p.created_at, m.created_at
      `).all() as Record<string, unknown>[];
      return rows.map((r) => ({
        id: r.id as string,
        providerId: r.provider_id as string,
        providerName: r.provider_name as string,
        modelId: r.model_id as string,
        name: r.name as string,
        contextTokens: (r.context_tokens as number | null | undefined) ?? null,
        maxOutputTokens: (r.max_output_tokens as number | null | undefined) ?? null,
        supportsTools: Number(r.supports_tools ?? 1) === 1,
        supportsImages: Number(r.supports_images ?? 0) === 1,
      }));
    },
    addModel(providerId: string, input: ModelInput): Model {
      const modelId = input.modelId.trim();
      if (!modelId) throw new Error('PROVIDER_MODEL_ID_REQUIRED');
      if (!isValidProviderModelId(modelId)) throw new Error('PROVIDER_MODEL_ID_INVALID');
      if (modelId.length > PROVIDER_FIELD_MAX.modelId) throw new Error('PROVIDER_MODEL_ID_TOO_LONG');
      const nameRaw = (input.name ?? '').trim();
      if (nameRaw && !isValidProviderModelName(nameRaw)) throw new Error('PROVIDER_MODEL_NAME_INVALID');
      if (nameRaw.length > PROVIDER_FIELD_MAX.modelName) throw new Error('PROVIDER_MODEL_NAME_TOO_LONG');
      const name = nameRaw || modelId;
      const contextTokens = normalizeContextTokens(input.contextTokens ?? null);
      const maxOutputTokens = normalizeMaxOutput(input.maxOutputTokens ?? null);
      const supportsTools = input.supportsTools !== false ? 1 : 0;
      const supportsImages = input.supportsImages === true ? 1 : 0;
      const id = randomUUID();
      db.prepare(
        `INSERT INTO models (
          id, provider_id, model_id, name, context_tokens,
          max_output_tokens, supports_tools, supports_images, created_at
        ) VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(id, providerId, modelId, name, contextTokens, maxOutputTokens, supportsTools, supportsImages, now());
      return this.listModels(providerId).find(m => m.id === id)!;
    },
    updateModel(id: string, patch: ModelUpdateInput): Model {
      const cur = db.prepare('SELECT * FROM models WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      if (!cur) throw new Error(`model not found: ${id}`);
      const nameRaw = patch.name !== undefined ? patch.name.trim() : (cur.name as string);
      if (!nameRaw) throw new Error('PROVIDER_MODEL_NAME_REQUIRED');
      if (!isValidProviderModelName(nameRaw)) throw new Error('PROVIDER_MODEL_NAME_INVALID');
      if (nameRaw.length > PROVIDER_FIELD_MAX.modelName) throw new Error('PROVIDER_MODEL_NAME_TOO_LONG');
      const contextTokens = patch.contextTokens !== undefined
        ? normalizeContextTokens(patch.contextTokens)
        : ((cur.context_tokens as number | null | undefined) ?? null);
      const maxOutputTokens = patch.maxOutputTokens !== undefined
        ? normalizeMaxOutput(patch.maxOutputTokens)
        : ((cur.max_output_tokens as number | null | undefined) ?? null);
      const supportsTools = patch.supportsTools !== undefined
        ? (patch.supportsTools ? 1 : 0)
        : (Number(cur.supports_tools ?? 1) === 1 ? 1 : 0);
      const supportsImages = patch.supportsImages !== undefined
        ? (patch.supportsImages ? 1 : 0)
        : (Number(cur.supports_images ?? 0) === 1 ? 1 : 0);
      db.prepare(
        `UPDATE models SET name=?, context_tokens=?, max_output_tokens=?, supports_tools=?, supports_images=?
         WHERE id=?`,
      ).run(nameRaw, contextTokens, maxOutputTokens, supportsTools, supportsImages, id);
      return this.listModels(cur.provider_id as string).find((m) => m.id === id)!;
    },
    setModelEnabled(id: string, enabled: boolean): Model {
      const row = db.prepare('SELECT provider_id FROM models WHERE id = ?').get(id) as { provider_id: string } | undefined;
      if (!row) throw new Error(`model not found: ${id}`);
      db.prepare('UPDATE models SET enabled=? WHERE id=?').run(enabled ? 1 : 0, id);
      return this.listModels(row.provider_id).find((m) => m.id === id)!;
    },
    removeModel(id: string): void {
      const row = db.prepare('SELECT id FROM models WHERE id = ?').get(id);
      if (!row) throw new Error(`model not found: ${id}`);
      db.prepare('UPDATE agents SET model_id = NULL WHERE model_id = ?').run(id);
      db.prepare('DELETE FROM models WHERE id = ?').run(id);
    },
  };
}
