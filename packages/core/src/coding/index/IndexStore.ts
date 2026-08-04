import { chunkFile, type Chunk } from './chunker';

// The brief types EmbeddingFn as Promise-only, but its own spec passes the
// synchronous hashEmbedding straight to the constructor — and IndexStore awaits
// the result either way. Widening to `number[] | Promise<number[]>` keeps the
// brief's sync hashEmbedding signature and lets a later Provider embedding
// return a Promise without changing call sites.
export type EmbeddingFn = (text: string) => number[] | Promise<number[]>;
export interface IndexRow { chunkId: string; path: string; startLine: number; endLine: number; text: string; embedding: number[] }
export interface IndexStoreAdapter { upsert(rows: IndexRow[]): void; all(): IndexRow[]; remove(path: string): void; clear(): void }
export interface IndexableFile { path: string; text: string }

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export class IndexStore {
  constructor(private adapter: IndexStoreAdapter, private embed: EmbeddingFn) {}

  // Full-reindex support: wipe EVERY row (not just one path) so a reindex
  // represents exactly the current workspace — stale chunks for files that no
  // longer exist, and rows from a previously reindexed workspace whose relative
  // paths don't collide, must not survive. (M4 Task 6 review fix)
  clear(): void { this.adapter.clear(); }

  async indexFiles(files: IndexableFile[]): Promise<void> {
    const rows: IndexRow[] = [];
    for (const f of files) {
      this.adapter.remove(f.path);
      for (const c of chunkFile(f.path, f.text)) {
        rows.push({ chunkId: c.id, path: c.path, startLine: c.startLine, endLine: c.endLine, text: c.text, embedding: await this.embed(c.text) });
      }
    }
    this.adapter.upsert(rows);
  }

  async search(query: string, k = 5): Promise<IndexRow[]> {
    const qv = await this.embed(query);
    return this.adapter.all()
      .map(r => ({ r, s: cosine(qv, r.embedding) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, k)
      .map(x => x.r);
  }
}

// Task 6 controller gap #1: tokens are normalized to their bare alphanumeric
// identifier BEFORE hashing so the semantic-relevance test's bare `add` query
// token matches the indexed `add(a:` text (which has no whitespace between the
// identifier and its parameter list). `add(a:` -> `add`, `number,` -> `number`,
// `b;` -> `b`. Without this the query's `add`/`a`/`b` tokens land in DIFFERENT
// hash bins than the source's `add(`/`a:`/`b;` tokens and the ranking degrades
// to near-arbitrary hash collisions instead of token overlap.
export function hashEmbedding(text: string, dim = 32): number[] {
  const v = new Array(dim).fill(0);
  for (const raw of text.split(/\s+/)) {
    const tok = raw.replace(/[^a-zA-Z0-9_]/g, '');
    if (!tok) continue;
    let h = 0;
    for (const ch of tok) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % dim] += 1;
  }
  return v;
}

export type { Chunk };
