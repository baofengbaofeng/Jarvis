import { describe, it, expect } from 'vitest';
import { chunkFile } from './chunker';
import { IndexStore, hashEmbedding, type IndexRow, type IndexStoreAdapter } from './IndexStore';
import { parseIgnorePatterns, isIgnored } from '../../sandbox/ignore';

describe('chunker', () => {
  it('splits a file into line-block chunks', () => {
    const text = 'export function a() {}\n\n\n\nexport function b() {}\n';
    const chunks = chunkFile('src/a.ts', text, 2);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].startLine).toBe(1);
  });
});

describe('IndexStore', () => {
  const mkAdapter = (): IndexStoreAdapter => {
    let rows: IndexRow[] = [];
    return {
      upsert(r) { rows = r; },
      all() { return rows; },
      remove(path) { rows = rows.filter(r => r.path !== path); },
      clear() { rows = []; }
    };
  };

  it('indexes files and finds relevant chunk by semantic query', async () => {
    const store = new IndexStore(mkAdapter(), hashEmbedding);
    await store.indexFiles([
      { path: 'src/add.ts', text: 'export function add(a: number, b: number) { return a + b; }' },
      { path: 'src/del.ts', text: 'export function removeAll() { /* nope */ }' }
    ]);
    const res = await store.search('export function add a b', 1);
    expect(res[0].path).toBe('src/add.ts');
  });

  it('filters ignored paths via jarvisignore', () => {
    const rx = parseIgnorePatterns(['node_modules/']);
    expect(isIgnored('/ws/node_modules/x.js', rx)).toBe(true);
    expect(isIgnored('/ws/src/a.ts', rx)).toBe(false);
  });
});
