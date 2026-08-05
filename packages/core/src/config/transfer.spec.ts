import { describe, it, expect } from 'vitest';
import {
  buildExport,
  validateSchema,
  planImport,
  mergeEntity,
  CURRENT_SCHEMA,
  type ExportPayload,
  type ProviderExport,
  type AgentExport,
} from './transfer';

describe('transfer', () => {
  const payload: ExportPayload = {
    schemaVersion: CURRENT_SCHEMA,
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
    expect(JSON.stringify(e)).not.toContain('sk-');
  });

  it('validateSchema rejects future versions', () => {
    expect(validateSchema({ ...payload, schemaVersion: CURRENT_SCHEMA + 1 }).ok).toBe(false);
    expect(validateSchema(payload).ok).toBe(true);
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
