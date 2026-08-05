import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../db/migrations';
import { createArtifactsIpc } from './artifacts';
import type { Artifact } from '@jarvis/core';

describe('artifacts IPC (K6)', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  it('save persists an artifact and list returns it for the task', () => {
    const artifacts = createArtifactsIpc(db);
    const saved = artifacts.save(null, { taskId: 't1', kind: 'table', title: 'results', content: '| A |\n|---|\n| 1 |' });
    expect(saved.id).toBeTruthy();
    const rows = artifacts.list(null, 't1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ taskId: 't1', kind: 'table', title: 'results', content: '| A |\n|---|\n| 1 |' });
    expect(rows[0].id).toBe(String(saved.id));
  });

  it('list scopes to the task id and omits title when NULL', () => {
    const artifacts = createArtifactsIpc(db);
    artifacts.save(null, { taskId: 't1', kind: 'markdown', content: 'prose' });
    artifacts.save(null, { taskId: 't2', kind: 'mermaid', content: 'graph TD; A-->B' });
    const t1 = artifacts.list(null, 't1');
    expect(t1).toHaveLength(1);
    expect(t1[0].title).toBeUndefined();
    const t2 = artifacts.list(null, 't2');
    expect(t2[0].kind).toBe('mermaid');
    // Unknown task -> empty list, not an error.
    expect(artifacts.list(null, 'nope')).toEqual([]);
  });

  it('round-trips all ArtifactKinds', () => {
    const artifacts = createArtifactsIpc(db);
    const kinds: Artifact['kind'][] = ['table', 'chart', 'mermaid', 'markdown'];
    for (const kind of kinds) artifacts.save(null, { taskId: 't1', kind, content: 'x' });
    const rows = artifacts.list(null, 't1');
    expect(rows.map(r => r.kind).sort()).toEqual([...kinds].sort());
  });
});
