import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { AgentConfig } from '@jarvis/protocol';
import { createAgentVersionStore } from './agents-versions';

export type ContextPassing = 'full' | 'summary' | 'conclusion' | 'custom';

export interface AgentInput { name: string; systemPrompt: string; modelId: string | null; workspaceId: string | null; description?: string; contextBudgetTokens?: number; planOnly?: boolean; envVars?: Record<string, string>; cliArgs?: string[]; contextPassing?: ContextPassing }

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';
}

export function createAgentStore(db: Database.Database) {
  const now = () => new Date().toISOString();
  const rowToAgent = (r: Record<string, unknown>): AgentConfig => {
    // env_vars_json / cli_args_json are not first-class AgentConfig columns, but
    // they ARE read back here so the renderer can pre-load (and round-trip) them
    // instead of blanking them on a save (M3 Task 9 fix, C8/C9 data-loss guard).
    let envVars: Record<string, string> = {};
    let cliArgs: string[] = [];
    try { envVars = JSON.parse((r.env_vars_json as string) ?? '{}') as Record<string, string>; } catch { /* malformed -> empty */ }
    try { cliArgs = JSON.parse((r.cli_args_json as string) ?? '[]') as string[]; } catch { /* malformed -> empty */ }
    return {
      id: r.id as string, name: r.name as string, slug: r.slug as string, description: (r.description as string) ?? '',
      systemPrompt: (r.system_prompt as string) ?? '', modelId: (r.model_id as string) ?? null, workspaceId: (r.workspace_id as string) ?? null,
      contextBudgetTokens: (r.context_budget_tokens as number) ?? 128000, planOnly: Boolean(r.plan_only),
      // L13: default to 'full' when the column is absent (pre-v6 DBs) or NULL,
      // so legacy agents pass the leader context verbatim without reconfig.
      contextPassing: (r.context_passing as ContextPassing) ?? 'full',
      envVars, cliArgs,
      createdAt: r.created_at as string, updatedAt: r.updated_at as string
    };
  };

  const get = (id: string): AgentConfig => {
    const r = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!r) throw new Error(`agent not found: ${id}`);
    return rowToAgent(r);
  };

  // M6 Task 9 (L31): snapshot-free raw write used ONLY by the version store's
  // rollback. It is the SAME UPDATE statement as `update`'s write but bypasses
  // the snapshot-before-write hook, so a rollback does not record itself as a
  // new version (which would create a snapshot per rollback and pollute the
  // history). The version store injects this as its applyAgent; the caller
  // (createAgentVersionStore) types it as Record<string, unknown>, so cast here.
  const applyRaw = (cfg: Record<string, unknown>): void => {
    const c = cfg as unknown as AgentConfig;
    const slug = slugify(c.name);
    db.prepare('UPDATE agents SET name=?, slug=?, system_prompt=?, model_id=?, workspace_id=?, description=?, context_budget_tokens=?, plan_only=?, env_vars_json=?, cli_args_json=?, context_passing=?, updated_at=? WHERE id=?')
      .run(c.name, slug, c.systemPrompt, c.modelId, c.workspaceId, c.description ?? '',
        c.contextBudgetTokens, c.planOnly ? 1 : 0,
        JSON.stringify(c.envVars ?? {}), JSON.stringify(c.cliArgs ?? []),
        // c.contextPassing is always defined (rowToAgent defaults to 'full').
        c.contextPassing ?? 'full', now(), c.id);
  };

  // AgentConfig is an interface (no index signature), so it is not assignable
  // to the version store's Record<string, unknown> getAgent param; the cast is
  // lossless — snapshot() only JSON.stringifies the config it reads.
  const versions = createAgentVersionStore(db, id => get(id) as unknown as Record<string, unknown>, applyRaw);

  return {
    list(): AgentConfig[] {
      return (db.prepare('SELECT * FROM agents ORDER BY created_at').all() as Record<string, unknown>[]).map(rowToAgent);
    },
    get,
    create(input: AgentInput): AgentConfig {
      const id = randomUUID();
      const slug = slugify(input.name);
      db.prepare('INSERT INTO agents (id, name, slug, description, system_prompt, model_id, workspace_id, context_budget_tokens, plan_only, env_vars_json, cli_args_json, context_passing, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, input.name, slug, input.description ?? '', input.systemPrompt, input.modelId, input.workspaceId,
          input.contextBudgetTokens ?? 128000, input.planOnly ? 1 : 0, JSON.stringify(input.envVars ?? {}), JSON.stringify(input.cliArgs ?? []),
          input.contextPassing ?? 'full', now(), now());
      return get(id);
    },
    update(id: string, patch: Partial<AgentInput>): AgentConfig {
      const cur = get(id);
      // L31: snapshot the OLD config BEFORE the write so version history always
      // retains the pre-update state (the just-applied update is the new head).
      versions.snapshot(id);
      // Read raw row to fall back to the persisted env_vars_json / cli_args_json
      // (AgentConfig does not expose them), so partial patches cannot silently
      // clobber those columns with the DB defaults.
      const raw = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Record<string, unknown>;
      const name = patch.name ?? cur.name;
      const slug = slugify(name);
      db.prepare('UPDATE agents SET name=?, slug=?, system_prompt=?, model_id=?, workspace_id=?, description=?, context_budget_tokens=?, plan_only=?, env_vars_json=?, cli_args_json=?, context_passing=?, updated_at=? WHERE id=?')
        .run(name, slug, patch.systemPrompt ?? cur.systemPrompt, patch.modelId !== undefined ? patch.modelId : cur.modelId,
          patch.workspaceId !== undefined ? patch.workspaceId : cur.workspaceId, patch.description ?? cur.description,
          patch.contextBudgetTokens ?? cur.contextBudgetTokens, patch.planOnly !== undefined ? (patch.planOnly ? 1 : 0) : (cur.planOnly ? 1 : 0),
          JSON.stringify(patch.envVars ?? JSON.parse((raw.env_vars_json as string) ?? '{}')),
          JSON.stringify(patch.cliArgs ?? JSON.parse((raw.cli_args_json as string) ?? '[]')),
          // cur.contextPassing is always defined (rowToAgent defaults to 'full'),
          // so an unrelated patch cannot clobber a saved strategy with the DB default.
          patch.contextPassing ?? cur.contextPassing,
          now(), id);
      return get(id);
    },
    remove(id: string): void {
      db.prepare('DELETE FROM agents WHERE id = ?').run(id);
    },
    // M6 Task 9 (L31): exposed so IpcRouter can register agents.versions /
    // agents.rollback against the SAME version store the update path snapshots.
    versions
  };
}
