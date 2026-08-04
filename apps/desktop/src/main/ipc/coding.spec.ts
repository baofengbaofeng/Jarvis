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
      const res = await reindexWorkspace(index, ws);
      expect(res.indexed).toBeGreaterThanOrEqual(1);
      expect(res.skipped).toBeGreaterThanOrEqual(2);

      const paths = adapter.all().map(r => r.path);
      expect(paths).toContain('src/add.ts');
      expect(paths).not.toContain('src/skip.ts'); // jarvisignore filter (L28)
      expect(paths).not.toContain('node_modules/dep.ts'); // node_modules skip
      expect(paths).not.toContain('.jarvisignore'); // hidden files not indexed

      // The reindexed store answers semantic queries against real file content.
      const found = await index.search('export function add a b', 1);
      expect(found[0].path).toBe('src/add.ts');
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});
