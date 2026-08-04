import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IndexStore, hashEmbedding } from '@jarvis/core';
import { applyMigrations } from '../db/migrations';
import { createCodeIndexAdapter, reindexWorkspace } from './coding';

// M4 Task 6 (E1/L27): the code index SQLite adapter round-trips IndexRow
// through the v2 code_chunks table, and reindexWorkspace walks a real workspace
// applying the L28 jarvisignore filter + node_modules skip while storing
// workspace-relative paths.

describe('code index adapter (E1/L27)', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  it('round-trips rows through the code_chunks table', () => {
    const adapter = createCodeIndexAdapter(db);
    adapter.upsert([
      { chunkId: 'a.ts:1-2', path: 'a.ts', startLine: 1, endLine: 2, text: 'line1\nline2', embedding: [1, 0, 1] },
      { chunkId: 'b.ts:1-1', path: 'b.ts', startLine: 1, endLine: 1, text: 'x', embedding: [0, 1, 0] }
    ]);
    const rows = adapter.all();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ chunkId: 'a.ts:1-2', path: 'a.ts', startLine: 1, endLine: 2, text: 'line1\nline2', embedding: [1, 0, 1] });
    adapter.remove('a.ts');
    expect(adapter.all().map(r => r.path)).toEqual(['b.ts']);
  });

  it('reindexes a workspace, skipping node_modules and jarvisignore-matched paths, storing relative paths', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'jarvis-idx-'));
    try {
      mkdirSync(join(ws, 'src'));
      mkdirSync(join(ws, 'node_modules'));
      writeFileSync(join(ws, 'src', 'add.ts'), 'export function add(a: number, b: number) { return a + b; }');
      writeFileSync(join(ws, 'src', 'skip.ts'), 'export const hidden = 1;');
      writeFileSync(join(ws, 'node_modules', 'dep.ts'), 'export const dep = 1;');
      writeFileSync(join(ws, '.jarvisignore'), 'src/skip.ts\n');

      const adapter = createCodeIndexAdapter(db);
      const index = new IndexStore(adapter, hashEmbedding);
      // Trailing slash: reindexWorkspace must normalize it so relative paths are
      // still computed correctly. (review fix)
      const res = await reindexWorkspace(index, ws + '/');
      expect(res.indexed).toBeGreaterThanOrEqual(1);
      // node_modules is now pruned during traversal (never walked), so only
      // src/skip.ts is counted as "skipped" via the jarvisignore filter.
      expect(res.skipped).toBeGreaterThanOrEqual(1);

      const paths = adapter.all().map(r => r.path);
      expect(paths).toContain('src/add.ts');
      expect(paths).not.toContain('src/skip.ts'); // jarvisignore filter (L28)
      expect(paths).not.toContain('node_modules/dep.ts'); // node_modules pruned during traversal
      expect(paths).not.toContain('.jarvisignore'); // hidden files not indexed

      // The reindexed store answers semantic queries against real file content.
      const found = await index.search('export function add a b', 1);
      expect(found[0].path).toBe('src/add.ts');
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('clears rows for files absent from the current workspace (stale chunks do not survive a reindex)', async () => {
    const wsA = mkdtempSync(join(tmpdir(), 'jarvis-idx-a-'));
    const wsB = mkdtempSync(join(tmpdir(), 'jarvis-idx-b-'));
    try {
      writeFileSync(join(wsA, 'add.ts'), 'export function add(a: number, b: number) { return a + b; }');
      const adapter = createCodeIndexAdapter(db);
      const index = new IndexStore(adapter, hashEmbedding);

      await reindexWorkspace(index, wsA);
      expect(adapter.all().map(r => r.path)).toContain('add.ts');

      // Reindex a DIFFERENT workspace that does not contain add.ts: the full
      // reindex must clear A's rows so the index is exactly workspace B, not a
      // union of every workspace ever reindexed.
      writeFileSync(join(wsB, 'other.ts'), 'export const other = 1;');
      await reindexWorkspace(index, wsB);
      const paths = adapter.all().map(r => r.path);
      expect(paths).not.toContain('add.ts');
      expect(paths).toContain('other.ts');
      // search returns up to k rows even at low similarity, so the proof that A's
      // stale chunks are gone is that add.ts no longer appears in the results.
      const found = await index.search('export function add', 5);
      expect(found.length).toBeGreaterThan(0);
      expect(found.map(r => r.path)).not.toContain('add.ts');
    } finally {
      rmSync(wsA, { recursive: true, force: true });
      rmSync(wsB, { recursive: true, force: true });
    }
  });
});
