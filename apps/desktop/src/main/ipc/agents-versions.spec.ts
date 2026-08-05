import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../db/migrations';
import { createAgentVersionStore } from './agents-versions';

// M6 Task 9 (L31): the version store is the main-owned history. getAgent reads
// the config to snapshot; applyAgent applies a snapshot on rollback. Both are
// injected so the store stays a pure table wrapper (agents.ts wires the real
// row reads/writes).
describe('agent version store', () => {
  let db: Database.Database;
  let current: Record<string, unknown>;
  let applied: Record<string, unknown> | null;

  beforeEach(() => {
    db = new Database(':memory:');
    applyMigrations(db);
    current = { id: 'a1', name: 'v1', model: 'm1' };
    applied = null;
  });

  const store = () => createAgentVersionStore(db, () => current, cfg => { applied = cfg; });

  it('snapshots the config at call time and lists versions newest-first', () => {
    const v = store();
    v.snapshot('a1');
    // Mutate the source AFTER the snapshot — the persisted row must still hold
    // the config as it was when snapshot() ran, not the live object.
    current = { id: 'a1', name: 'v2', model: 'm2' };
    v.snapshot('a1');

    const rows = db.prepare('SELECT snapshot_json FROM agent_config_versions ORDER BY created_at').all() as Array<{ snapshot_json: string }>;
    expect(rows).toHaveLength(2);
    expect(JSON.parse(rows[0].snapshot_json).name).toBe('v1');
    expect(JSON.parse(rows[1].snapshot_json).name).toBe('v2');

    const list = v.list('a1');
    expect(list).toHaveLength(2);
    // Newest first (ORDER BY created_at DESC).
    expect(list[0].createdAt >= list[1].createdAt).toBe(true);
    // fields is the snapshot's top-level key set.
    expect(list[0].fields.sort()).toEqual(['id', 'model', 'name']);
  });

  it('rolls back by applying the snapshot through applyAgent', () => {
    const v = store();
    v.snapshot('a1');
    const [version] = v.list('a1');
    v.rollback(version.id);
    expect(applied).toEqual({ id: 'a1', name: 'v1', model: 'm1' });
  });

  it('throws on an unknown version id', () => {
    const v = store();
    expect(() => v.rollback('nope')).toThrow('version nope not found');
  });

  // L31 review fix: rollback is scoped by agent_id (defense-in-depth) so a
  // version owned by another agent cannot be applied even if the IPC cross-agent
  // guard were bypassed.
  it('refuses to roll back a version owned by another agent when scoped by agent id', () => {
    const v = store();
    v.snapshot('a1');
    const [version] = v.list('a1');
    expect(() => v.rollback(version.id, 'other')).toThrow('not found');
    // The unscoped call still works (backward-compatible single-arg form).
    v.rollback(version.id);
    expect(applied).toEqual({ id: 'a1', name: 'v1', model: 'm1' });
  });
});
