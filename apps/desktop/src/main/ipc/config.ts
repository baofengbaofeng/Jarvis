import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import type Database from 'better-sqlite3';
import {
  buildExport,
  planImport,
  validateSchema,
  type AgentExport,
  type ExportPayload,
  type ImportStrategy,
  type ProviderExport,
} from '@jarvis/core';

// Only persist settings whose value round-trips through JSON.stringify. Values
// exported from the settings table already came from JSON.parse, so in practice
// everything is serializable; the guard just skips anything that is not (e.g. a
// future caller stuffing a non-JSON value into the payload).
function toJson(v: unknown): string | null {
  try {
    const s = JSON.stringify(v);
    return typeof s === 'string' ? s : null;
  } catch {
    return null;
  }
}

// C12 (M8 Task 6): config import/export over the main-owned providers/models/
// agents/settings tables. Export NEVER contains plaintext API keys — only the
// keychain ref (apiKeyRef) is carried. Import applies an ImportStrategy
// (skip/overwrite/merge) computed by the pure planImport in @jarvis/core.
export function createConfigIpc(db: Database.Database, settingsGet?: (k: string) => unknown) {
  // Correction #4: settingsGet('__all__') does not exist on the M0 store, so
  // read every settings row directly (main-owned key/value table). The optional
  // settingsGet param is kept for IPC-shape compatibility and used only as a
  // last-resort fallback when the settings table is empty.
  const readSettings = (): Record<string, unknown> => {
    const rows = db.prepare('SELECT key, value_json FROM settings').all() as Array<{ key: string; value_json: string }>;
    if (rows.length > 0) return Object.fromEntries(rows.map(r => [r.key, JSON.parse(r.value_json)]));
    const viaGet = settingsGet?.('__all__');
    return viaGet && typeof viaGet === 'object' ? (viaGet as Record<string, unknown>) : {};
  };

  const loadPayload = (): ExportPayload => {
    const providers = db.prepare('SELECT id, name, type, base_url, api_key_ref FROM providers').all() as Array<{
      id: string;
      name: string;
      type: string;
      base_url: string;
      api_key_ref: string | null;
    }>;
    const models = db.prepare('SELECT id, provider_id AS providerId, model_id AS modelId, name FROM models').all() as ExportPayload['models'];
    const agents = db.prepare('SELECT id, name, slug, description, system_prompt AS systemPrompt, model_id AS modelId FROM agents').all() as ExportPayload['agents'];
    return buildExport(providers, models, agents, readSettings());
  };

  const exportConfig = (format: 'json' | 'yaml' = 'json') => {
    const payload = loadPayload();
    return format === 'yaml' ? yamlStringify(payload) : JSON.stringify(payload, null, 2);
  };

  const importConfig = (text: string, strategy: ImportStrategy) => {
    let payload: ExportPayload;
    try {
      payload = (text.trim().startsWith('{') ? JSON.parse(text) : yamlParse(text)) as ExportPayload;
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
    const chk = validateSchema(payload);
    if (!chk.ok) return { ok: false as const, error: chk.error };

    const current = {
      providers: db.prepare('SELECT id, name, type, base_url AS baseUrl, api_key_ref AS apiKeyRef FROM providers').all() as ProviderExport[],
      agents: db.prepare('SELECT id, name, slug FROM agents').all() as AgentExport[],
    };
    const plan = planImport(payload, current, strategy);
    const skipped = [...plan.skip];
    const now = new Date().toISOString();

    try {
      db.transaction(() => {
        const insP = db.prepare('INSERT INTO providers (id, name, type, base_url, api_key_ref, created_at, updated_at) VALUES (?,?,?,?,?,?,?)');
        for (const p of plan.create) {
          if ('baseUrl' in p) insP.run(p.id, p.name, p.type, p.baseUrl, p.apiKeyRef ?? '', now, now);
        }
        const updP = db.prepare('UPDATE providers SET name = ?, type = ?, base_url = ?, updated_at = ? WHERE id = ?');
        for (const p of plan.update) {
          if ('baseUrl' in p) updP.run(p.name, p.type, p.baseUrl, now, p.id);
        }

        // Agents: preserve modelId only when the referenced model already exists
        // (models are not imported in C12); a missing model raises an FK error,
        // so skip that agent rather than failing the whole import. A UNIQUE slug
        // collision on a different id is caught the same way.
        const insA = db.prepare('INSERT INTO agents (id, name, slug, model_id, created_at, updated_at) VALUES (?,?,?,?,?,?)');
        for (const a of plan.create) {
          if ('slug' in a) {
            try {
              insA.run(a.id, a.name, a.slug, a.modelId ?? null, now, now);
            } catch {
              skipped.push(a.id);
            }
          }
        }
        const updA = db.prepare('UPDATE agents SET name = ?, slug = ?, model_id = ?, updated_at = ? WHERE id = ?');
        for (const a of plan.update) {
          if ('slug' in a) {
            try {
              updA.run(a.name, a.slug, a.modelId ?? null, now, a.id);
            } catch {
              skipped.push(a.id);
            }
          }
        }

        const insS = db.prepare('INSERT OR REPLACE INTO settings (key, value_json) VALUES (?,?)');
        for (const [k, v] of Object.entries(payload.settings ?? {})) {
          const json = toJson(v);
          if (json !== null) insS.run(k, json);
        }
      })();
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
    return { ok: true as const, created: plan.create.length, updated: plan.update.length, skipped: skipped.length };
  };

  return { exportConfig, importConfig };
}
