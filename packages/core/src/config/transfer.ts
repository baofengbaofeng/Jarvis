// C12 (M8 Task 6): config import/export transfer model. Pure functions with no
// node:* deps — re-exported from BOTH core barrels (index.ts + renderer.ts) so
// main and the renderer share the same shapes/validators.

// Latest migration version (desktop db migrations latestVersion() = 12, added
// by K6/M8 Task 10 for task_artifacts). Keep in sync with that: an export at 11
// would be rejected by a future 12 importer, so an export must always carry the
// CURRENT version.
export const CURRENT_SCHEMA = 12;

export interface ProviderExport {
  id: string;
  // providers.name is NOT NULL in the real schema — export/import must carry it.
  name: string;
  type: string;
  baseUrl: string;
  // Keychain reference only — NEVER a plaintext API key (C12).
  apiKeyRef?: string;
  [k: string]: unknown;
}

export interface ModelExport {
  id: string;
  providerId: string;
  modelId: string;
  name: string;
  [k: string]: unknown;
}

export interface AgentExport {
  id: string;
  name: string;
  slug: string;
  description?: string;
  systemPrompt?: string;
  modelId?: string;
  [k: string]: unknown;
}

export interface ExportPayload {
  schemaVersion: number;
  exportedAt: string;
  providers: ProviderExport[];
  models: ModelExport[];
  agents: AgentExport[];
  settings: Record<string, unknown>;
}

export type ImportStrategy = 'skip' | 'overwrite' | 'merge';

/** Settings keys safe to include in config export (no plaintext secrets). */
const EXPORT_ALLOWED_SETTINGS_KEYS = new Set([
  'concurrency',
  'backup_interval_min',
  'shortcuts',
  'proxy_json',
  'search_providers',
  'image.api_key_ref',
  'data_policy',
  'multica.conflicts',
]);

function redactSearchProviders(value: unknown): unknown {
  if (!Array.isArray(value)) return undefined;
  return value.map(item => {
    const o = item as Record<string, unknown>;
    return {
      type: o.type,
      apiKeyRef: o.apiKeyRef,
      enabled: o.enabled,
    };
  });
}

/** Strip secret-shaped settings before export; only explicit allowlist keys pass through. */
export function redactExportSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!EXPORT_ALLOWED_SETTINGS_KEYS.has(key)) continue;
    out[key] = key === 'search_providers' ? redactSearchProviders(value) : value;
  }
  return out;
}

export interface ImportPlan {
  create: Array<ProviderExport | AgentExport>;
  update: Array<ProviderExport | AgentExport>;
  skip: string[];
}

export function buildExport(
  providers: Array<{ id: string; name: string; type: string; base_url: string; api_key_ref?: string | null }>,
  models: ModelExport[],
  agents: AgentExport[],
  settings: Record<string, unknown>,
): ExportPayload {
  return {
    schemaVersion: CURRENT_SCHEMA,
    exportedAt: new Date().toISOString(),
    providers: providers.map(p => ({
      id: p.id,
      name: p.name,
      type: p.type,
      baseUrl: p.base_url,
      apiKeyRef: p.api_key_ref ?? undefined,
    })),
    models,
    agents,
    settings,
  };
}

export function validateSchema(p: ExportPayload): { ok: true } | { ok: false; error: string } {
  // Guard the boundary: a config file that parses to JSON `null` or an empty
  // YAML document yields a null payload, which must be a clean { ok:false }
  // instead of a TypeError escaping as an ipcMain rejection.
  if (typeof p !== 'object' || p === null) return { ok: false, error: 'missing schemaVersion' };
  if (typeof p.schemaVersion !== 'number' || p.schemaVersion < 1) return { ok: false, error: 'missing schemaVersion' };
  if (p.schemaVersion > CURRENT_SCHEMA) return { ok: false, error: `schema ${p.schemaVersion} > current ${CURRENT_SCHEMA}` };
  return { ok: true };
}

// Merge incoming non-empty fields over existing; empty (''/null/undefined) values
// are never applied so a template's blank apiKeyRef cannot clobber a real one.
export function mergeEntity<T extends { id: string }>(existing: T, incoming: Partial<T>): T {
  const out = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    if (v !== undefined && v !== null && v !== '') (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

export function planImport(
  p: ExportPayload,
  current: { providers: ProviderExport[]; agents: AgentExport[] },
  strategy: ImportStrategy,
): ImportPlan {
  // Explicit union-typed maps (Map is invariant in V under strict, so a plain
  // Map<string, ProviderExport> would not satisfy the decide() parameter).
  const provCur = new Map<string, ProviderExport | AgentExport>(current.providers.map(x => [x.id, x]));
  const agentCur = new Map<string, ProviderExport | AgentExport>(current.agents.map(x => [x.id, x]));
  const plan: ImportPlan = { create: [], update: [], skip: [] };
  const decide = (
    id: string,
    incoming: ProviderExport | AgentExport,
    cur: Map<string, ProviderExport | AgentExport>,
  ) => {
    if (!cur.has(id)) { plan.create.push(incoming); return; }
    if (strategy === 'skip') { plan.skip.push(id); return; }
    const existing = cur.get(id) as ProviderExport | AgentExport;
    plan.update.push(strategy === 'merge' ? mergeEntity(existing, incoming) : incoming);
  };
  for (const prov of p.providers) decide(prov.id, prov, provCur);
  for (const agent of p.agents) decide(agent.id, agent, agentCur);
  return plan;
}
