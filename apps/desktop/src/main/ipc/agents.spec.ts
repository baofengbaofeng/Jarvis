import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../db/migrations';
import { createAgentStore } from './agents';

describe('agent store', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  it('creates and lists agent with slug', async () => {
    const store = createAgentStore(db);
    const a = store.create({ name: 'Coding Agent', systemPrompt: 'You write code', modelId: null, workspaceId: null });
    expect(a.slug).toBe('coding-agent');
    expect(store.list().length).toBe(1);
  });

  it('updates agent fields', async () => {
    const store = createAgentStore(db);
    const a = store.create({ name: 'A', systemPrompt: '', modelId: null, workspaceId: null });
    const updated = store.update(a.id, { systemPrompt: 'new prompt' });
    expect(updated.systemPrompt).toBe('new prompt');
  });

  it('defaults context_passing to full and persists an explicit strategy', async () => {
    const store = createAgentStore(db);
    // Default when not provided.
    const a = store.create({ name: 'Default Agent', systemPrompt: '', modelId: null, workspaceId: null });
    expect(a.contextPassing).toBe('full');
    // Explicit strategy is persisted and read back.
    const updated = store.update(a.id, { contextPassing: 'conclusion' });
    expect(updated.contextPassing).toBe('conclusion');
    const row = db.prepare('SELECT context_passing FROM agents WHERE id = ?').get(a.id) as { context_passing: string };
    expect(row.context_passing).toBe('conclusion');
    // An unrelated patch keeps the saved strategy (does not reset to the default).
    const renamed = store.update(a.id, { name: 'Renamed Agent' });
    expect(renamed.contextPassing).toBe('conclusion');
  });

  it('persists envVars and cliArgs, and an unrelated patch does not clobber them while renaming regenerates the slug', async () => {
    const store = createAgentStore(db);
    const a = store.create({ name: 'Env Agent', systemPrompt: '', modelId: null, workspaceId: null });

    const updated = store.update(a.id, { envVars: { FOO: 'bar', BAZ: '1' }, cliArgs: ['--verbose', 'run'] });
    // Assert via the raw row so the DB columns are covered directly; the
    // store also maps them onto AgentConfig.envVars/cliArgs for the renderer.
    let row = db.prepare('SELECT env_vars_json, cli_args_json FROM agents WHERE id = ?').get(a.id) as { env_vars_json: string; cli_args_json: string };
    expect(JSON.parse(row.env_vars_json)).toEqual({ FOO: 'bar', BAZ: '1' });
    expect(JSON.parse(row.cli_args_json)).toEqual(['--verbose', 'run']);
    expect(updated.slug).toBe('env-agent');

    // An unrelated patch (rename + prompt) must keep envVars/cliArgs intact.
    const renamed = store.update(a.id, { name: 'Renamed Agent', systemPrompt: 'be terse' });
    expect(renamed.name).toBe('Renamed Agent');
    expect(renamed.slug).toBe('renamed-agent');
    row = db.prepare('SELECT env_vars_json, cli_args_json FROM agents WHERE id = ?').get(a.id) as { env_vars_json: string; cli_args_json: string };
    expect(JSON.parse(row.env_vars_json)).toEqual({ FOO: 'bar', BAZ: '1' });
    expect(JSON.parse(row.cli_args_json)).toEqual(['--verbose', 'run']);
  });

  // M6 Task 9 (L31): update snapshots the OLD config before the write so the
  // version history always retains the pre-update state. The snapshot happens
  // inside createAgentStore.update (not in the IPC layer), so ANY update path
  // (agent.update IPC, skills import, future flows) is versioned.
  it('snapshots the pre-update config before each update', () => {
    const store = createAgentStore(db);
    const a = store.create({ name: 'A', systemPrompt: 'v1', modelId: null, workspaceId: null });
    store.update(a.id, { systemPrompt: 'v2' });
    store.update(a.id, { systemPrompt: 'v3' });

    // Two updates -> two snapshots, each holding the config BEFORE that update.
    const rows = db.prepare('SELECT snapshot_json FROM agent_config_versions ORDER BY created_at').all() as Array<{ snapshot_json: string }>;
    expect(rows).toHaveLength(2);
    expect(JSON.parse(rows[0].snapshot_json).systemPrompt).toBe('v1');
    expect(JSON.parse(rows[1].snapshot_json).systemPrompt).toBe('v2');
    // The live agent is the post-update head, not a snapshot.
    expect(store.get(a.id).systemPrompt).toBe('v3');
  });

  // L31 rollback restores a snapshot's config through the snapshot-free raw
  // write (applyRaw), so the history count does NOT grow on every rollback.
  it('rolls back to a snapshot and restores the config', () => {
    const store = createAgentStore(db);
    const a = store.create({ name: 'A', systemPrompt: 'v1', modelId: null, workspaceId: null });
    store.update(a.id, { systemPrompt: 'v2' });

    const [version] = store.versions.list(a.id);
    store.versions.rollback(version.id);
    expect(store.get(a.id).systemPrompt).toBe('v1');
    // No new snapshot was written by the rollback itself.
    const rows = db.prepare('SELECT COUNT(*) AS c FROM agent_config_versions').get() as { c: number };
    expect(rows.c).toBe(1);
  });
});
