import { describe, it, expect } from 'vitest';
import { CONFIG_SCHEMA_VERSION } from '@jarvis/protocol';
import {
  buildExport,
  validateSchema,
  planImport,
  mergeEntity,
  redactExportSettings,
  LEGACY_CONFIG_SCHEMA_VERSION,
  type ExportPayload,
  type ProviderExport,
  type AgentExport,
} from './transfer';

describe('transfer', () => {
  const payload: ExportPayload = {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    exportedAt: '2026-08-03T00:00:00Z',
    providers: [{ id: 'p1', name: 'Provider 1', type: 'openai-compatible', baseUrl: 'https://x.example', apiKeyRef: 'keychain:p1' }],
    models: [],
    agents: [],
    settings: { concurrency: { perAgent: 3 } },
  };

  it('buildExport carries apiKeyRef not plaintext and keeps provider name', () => {
    const e = buildExport(
      [{ id: 'p1', name: 'Provider 1', type: 'openai-compatible', base_url: 'https://x.example', api_key_ref: 'keychain:p1' }],
      [],
      [],
      { concurrency: { perAgent: 3 } },
    );
    expect(e.providers[0].apiKeyRef).toBe('keychain:p1');
    expect(e.providers[0].name).toBe('Provider 1');
    expect(e.schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
    expect(JSON.stringify(e)).not.toContain('sk-');
  });

  it('validateSchema rejects future versions and accepts legacy numeric schema', () => {
    expect(validateSchema({ ...payload, schemaVersion: '2.0.0' }).ok).toBe(false);
    expect(validateSchema({ ...payload, schemaVersion: LEGACY_CONFIG_SCHEMA_VERSION + 1 }).ok).toBe(false);
    expect(validateSchema(payload).ok).toBe(true);
    expect(validateSchema({ ...payload, schemaVersion: LEGACY_CONFIG_SCHEMA_VERSION }).ok).toBe(true);
  });

  it('validateSchema rejects non-object payloads instead of throwing', () => {
    expect(validateSchema(null as unknown as ExportPayload)).toEqual({ ok: false, error: 'missing schemaVersion' });
    expect(validateSchema(undefined as unknown as ExportPayload).ok).toBe(false);
  });

  it('planImport applies skip/overwrite/merge on id', () => {
    const current: { providers: ProviderExport[]; agents: AgentExport[] } = {
      providers: [{ id: 'p1', name: 'Old', type: 'openai-compatible', baseUrl: 'old', apiKeyRef: 'keychain:p1' }],
      agents: [],
    };
    const planSkip = planImport(payload, current, 'skip');
    expect(planSkip.skip).toHaveLength(1);

    const planOv = planImport(payload, current, 'overwrite');
    expect(planOv.update[0].baseUrl).toBe('https://x.example');

    const planMg = planImport(payload, current, 'merge');
    expect(mergeEntity(current.providers[0], payload.providers[0]).baseUrl).toBe('https://x.example');
    expect(planMg.update[0].apiKeyRef).toBe('keychain:p1');
  });

  it('redacts secret-shaped settings and preserves search refs', () => {
    expect(redactExportSettings({
      search_providers: [{ type: 'serper', apiKey: 'secret', apiKeyRef: 'search:serper:key', enabled: true }],
      image: { apiKey: 'secret-2' },
      concurrency: { perAgent: 2 },
    })).toEqual({
      search_providers: [{ type: 'serper', apiKeyRef: 'search:serper:key', enabled: true }],
      concurrency: { perAgent: 2 },
    });
  });

  it('planImport collects brand-new providers/agents into create', () => {
    const payload2: ExportPayload = {
      ...payload,
      agents: [{ id: 'a1', name: 'Agent 1', slug: 'agent-1', modelId: 'm1' }],
    };
    const plan = planImport(payload2, { providers: [], agents: [] }, 'skip');
    expect(plan.create).toHaveLength(2);
    expect(plan.skip).toHaveLength(0);
  });
});
