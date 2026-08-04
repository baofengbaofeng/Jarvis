import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { createTaskSnapshot, parseIgnorePatterns, isIgnored, type SnapshotGit, type SnapshotFs, type SnapshotMeta, type SnapshotStore, type IndexStore, type IndexRow } from '@jarvis/core';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

// M4 Task 2 (L26): task-level snapshots. createSnapshotStore persists SnapshotMeta
// rows into the v2 task_snapshots table; snapshotBeforeTask captures pre-task
// state so a later task.rollback can restore it. The git/fs implementations are
// factored into createSnapshotGit/createSnapshotFs so both the pre-task capture
// and the rollback restore share the exact same I/O.

export function createSnapshotStore(db: Database.Database): { save: (t: string, m: SnapshotMeta) => void; get: (t: string) => SnapshotMeta | null } {
  const insert = db.prepare('INSERT INTO task_snapshots (id, task_id, kind, meta_json, created_at) VALUES (?,?,?,?,?)');
  const select = db.prepare('SELECT kind, meta_json FROM task_snapshots WHERE task_id = ?');
  return {
    save(taskId, meta) { insert.run(randomUUID(), taskId, meta.kind, JSON.stringify(meta), new Date().toISOString()); },
    get(taskId) { const r = select.get(taskId) as { kind: string; meta_json: string } | undefined; return r ? JSON.parse(r.meta_json) as SnapshotMeta : null; }
  };
}

export function createSnapshotGit(): SnapshotGit {
  return { exec: async (args, cwd) => { const { stdout, stderr } = await exec('git', args, { cwd }); return { stdout, stderr }; } };
}

export function createSnapshotFs(): SnapshotFs {
  return {
    exists: existsSync,
    read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
    write: (p, c) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, c); },
    mkdir: (p) => mkdirSync(p, { recursive: true }),
    walk: (p) => { const out: string[] = []; const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const f = join(d, e.name); if (e.isDirectory()) walk(f); else out.push(f); } }; walk(p); return out; }
  };
}

export async function snapshotBeforeTask(wsRoot: string, taskId: string, store: SnapshotStore): Promise<void> {
  const isGitRepo = existsSync(join(wsRoot, '.git'));
  await createTaskSnapshot({ taskId, workspaceRoot: wsRoot, git: createSnapshotGit(), fs: createSnapshotFs(), store, isGitRepo });
}

// =============================================================================
// M4 Task 6 (E1/L27): code index infrastructure + L28 jarvisignore filter.
// =============================================================================

// SQLite adapter over the v2 code_chunks table. IndexStore.indexFiles calls
// adapter.remove(path) per file before the batched upsert, so plain INSERT (not
// INSERT OR REPLACE) is safe: each file's old chunk rows are gone before its new
// chunk rows land, and chunkIds are unique per path+line-range.
export function createCodeIndexAdapter(db: Database.Database) {
  const del = db.prepare('DELETE FROM code_chunks WHERE path = ?');
  const ins = db.prepare('INSERT INTO code_chunks (id, path, start_line, end_line, text, embedding_json, updated_at) VALUES (?,?,?,?,?,?,?)');
  return {
    upsert(rows: IndexRow[]) { for (const r of rows) ins.run(r.chunkId, r.path, r.startLine, r.endLine, r.text, JSON.stringify(r.embedding), new Date().toISOString()); },
    all(): IndexRow[] { return (db.prepare('SELECT * FROM code_chunks').all() as Array<Record<string, unknown>>).map(r => ({ chunkId: r.id as string, path: r.path as string, startLine: r.start_line as number, endLine: r.end_line as number, text: r.text as string, embedding: JSON.parse(r.embedding_json as string) as number[] })); },
    remove(path: string) { del.run(path); }
  };
}

// L28: read the workspace's .jarvisignore into raw pattern lines (blank lines and
// # comments stripped; negation lines are skipped by parseIgnorePatterns). Falls
// back to the same defaults the Sandbox applies (node_modules/.git/dist) so the
// index never ingests dependency or VCS internals.
const DEFAULT_IGNORE = ['node_modules/', '.git/', 'dist/', '.jarvis/'];

function readJarvisignore(wsRoot: string): string[] {
  try {
    const content = readFileSync(join(wsRoot, '.jarvisignore'), 'utf8');
    return content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  } catch { return []; }
}

// Depth-first walk of a workspace directory, reusing the createSnapshotFs.walk
// pattern (snapshot.ts). Hidden entries (leading `.`) are never indexed — that
// keeps .git/.jarvis internals AND meta files like .jarvisignore/.env out of the
// code index. A directory that cannot be read is skipped rather than fatal
// (symlink loops / permission errors must not kill a reindex).
function walkWorkspaceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const f = join(d, e.name);
      if (e.isDirectory()) walk(f);
      else out.push(f);
    }
  };
  walk(root);
  return out;
}

// index.reindex handler body: walk the workspace, filter node_modules + jarvisignore
// matched paths (L28), read every remaining file, and (re)index it. Paths are stored
// RELATIVE to the workspace so the search_code tool's output is actionable
// ("src/add.ts:1-3"), while the ignore filter is applied on ABSOLUTE paths (the
// same contract index.spec's isIgnored test asserts).
export async function reindexWorkspace(index: IndexStore, wsRoot: string): Promise<{ indexed: number; skipped: number }> {
  const ignorePatterns = parseIgnorePatterns([...DEFAULT_IGNORE, ...readJarvisignore(wsRoot)]);
  const files = walkWorkspaceFiles(wsRoot);
  const indexable: Array<{ path: string; text: string }> = [];
  let skipped = 0;
  for (const abs of files) {
    const rel = abs.slice(wsRoot.length + 1);
    if (isIgnored(abs, ignorePatterns)) { skipped++; continue; }
    let text: string;
    try { text = readFileSync(abs, 'utf8'); } catch { skipped++; continue; }
    indexable.push({ path: rel, text });
  }
  await index.indexFiles(indexable);
  return { indexed: indexable.length, skipped };
}

// INCREMENTAL UPDATE (deferred follow-up): the brief's Step 6 fs.watch wiring is
// intentionally deferred. The lifecycle (per-workspace watcher registry, teardown
// on agent unbind / app quit) and recursive-watch portability (Linux lacks it)
// make it too heavy to land safely here. What remains, exactly:
//   1. A per-workspace map<wsRoot, FSWatcher> in IpcRouter (or a dedicated
//      WorkspaceIndexSupervisor), populated on index.reindex and removed when an
//      agent's workspace is unbound or on app 'will-quit'.
//   2. fs.watch(wsRoot, { recursive: true }) callback, debounced 800ms via the
//      core `debounce` util (@jarvis/core), that re-runs reindexWorkspace for the
//      changed workspace (full reindex is fine at this index size; a per-file
//      path-scoped diff is an optimization, not a correctness requirement).
//   3. On a 'rename' event where the target file no longer exists, call
//      adapter.remove(relPath) so deletions are reflected without a full walk.
// The on-demand index.reindex IPC (already wired) is the deterministic,
// testable path until that lands.

