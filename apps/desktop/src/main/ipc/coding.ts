import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { createTaskSnapshot, parseIgnorePatterns, isIgnored, diffLines, groupHunks, applyHunks, toUnified, type SnapshotGit, type SnapshotFs, type SnapshotMeta, type SnapshotStore, type IndexStore, type IndexRow } from '@jarvis/core';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
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
    remove(path: string) { del.run(path); },
    clear() { db.prepare('DELETE FROM code_chunks').run(); }
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

// Directory names pruned DURING traversal (never descended into), so a typical
// project's node_modules/ (tens of thousands of dependency files) is not walked.
// Hidden entries are already skipped above, so .git/.jarvis are covered by the
// `.` check as well — kept here for clarity/defense-in-depth.
const PRUNE_DIRS = new Set(['node_modules', 'dist', '.git', '.jarvis']);

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
      if (e.isDirectory()) {
        if (PRUNE_DIRS.has(e.name)) continue; // prune dep/VCS dirs during traversal
        walk(f);
      } else out.push(f);
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
  // Normalize a trailing-separator wsRoot so `abs.slice(root.length + 1)` below
  // slices exactly the leading separator (never one char into the first path
  // segment). (review fix)
  const root = wsRoot.replace(/[\\/]+$/, '');
  // A full reindex represents EXACTLY the current workspace: clear every row
  // first so chunks for files deleted since the last index, and rows from a
  // previously reindexed workspace whose relative paths don't collide, do not
  // survive. (review fix)
  index.clear();
  const ignorePatterns = parseIgnorePatterns([...DEFAULT_IGNORE, ...readJarvisignore(root)]);
  const files = walkWorkspaceFiles(root);
  const indexable: Array<{ path: string; text: string }> = [];
  let skipped = 0;
  for (const abs of files) {
    const rel = abs.slice(root.length + 1);
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

// =============================================================================
// M4 Task 8 (E9): diff.applyAll + diff.read. The base of a diff is resolved
// snapshot-first, then git HEAD, then an EMPTY base (a task-created file is a
// full add). The snapshot is authoritative because it holds the exact pre-task
// content of every dirty/untracked file (git) or the whole workspace (non-git),
// so the diff shows ONLY the task's changes and never writes HEAD back over
// pre-task uncommitted work (M4 review findings 3 & 4). git HEAD is only
// reached for files that were unmodified pre-task (so HEAD == pre-task), and an
// empty base turns a task-created file into a reviewable full-add diff. The base
// never silently falls back to the CURRENT file — base == modified would make
// the diff a no-op (controller gap #2).
// =============================================================================

function toLines(text: string): string[] {
  // Empty text must produce an EMPTY line list: '' .replace(...).split('\n')
  // yields [''] — one phantom context line that corrupts the diff for a
  // task-created file (base [] vs a real single-line file must differ). (M4
  // review finding 3)
  return text ? text.replace(/\n$/, '').split('\n') : [];
}

function resolveDiffBase(wsRoot: string, path: string, taskId: string, snapshotStore: SnapshotStore): { base: string[] } | { error: string } {
  // 1) Task snapshot FIRST (M4 review finding 4): the snapshot holds the exact
  // pre-task content of every file that differed from HEAD/index at capture
  // time (dirty tracked files via `git diff --name-only`, untracked files via
  // `git ls-files --others`) and, for non-git workspaces, the whole workspace
  // minus ignores. Using it as the base guarantees the E9 diff shows ONLY the
  // task's changes — rejecting a hunk restores the user's pre-task state and
  // never writes HEAD back over pre-task uncommitted work.
  const meta = snapshotStore.get(taskId);
  // meta.files may be absent (legacy git rows stored only {kind, patchFile}).
  if (meta && (meta.kind === 'copy' || meta.kind === 'git') && meta.files) {
    if (Array.isArray(meta.files)) {
      if (meta.files.includes(path)) {
        try {
          const content = readFileSync(join(meta.dir, path), 'utf8');
          return { base: toLines(content) };
        } catch { /* snapshot file missing on disk; fall through */ }
      }
    } else if (typeof (meta.files as unknown as Record<string, string>)[path] === 'string') {
      // Legacy row: meta.files[path] IS the pre-task content (pre-M4-review).
      return { base: toLines((meta.files as unknown as Record<string, string>)[path]) };
    }
  }
  // 2) git HEAD: safe ONLY because reaching it means the file was UNMODIFIED
  // pre-task (otherwise the snapshot above would hold it), so HEAD == pre-task.
  try {
    const stdout = execFileSync('git', ['show', `HEAD:${path}`], { cwd: wsRoot, encoding: 'utf8' });
    return { base: toLines(stdout) };
  } catch { /* not a git repo, untracked file, or no HEAD yet */ }
  // 3) No base anywhere: the file did not exist pre-task, so it is a full ADD —
  // the empty base makes the whole current file a reviewable diff, and rejecting
  // every hunk removes the file (applyDiffToFile unlinks it). (finding 3)
  return { base: [] };
}

export function applyDiffToFile(wsRoot: string, path: string, accepts: boolean[], taskId: string, snapshotStore: SnapshotStore): { ok: boolean; error?: string } {
  const abs = join(wsRoot, path);
  if (!existsSync(abs)) return { ok: false, error: 'file not found' };
  const modified = toLines(readFileSync(abs, 'utf8'));
  const baseRes = resolveDiffBase(wsRoot, path, taskId, snapshotStore);
  if ('error' in baseRes) return { ok: false, error: baseRes.error };
  const hunks = groupHunks(diffLines(baseRes.base, modified));
  // A stale/short decisions array (e.g. decisions computed for a different file)
  // would make applyHunks treat missing entries as falsy -> reject undecided
  // hunks silently. Refuse instead. (review fix)
  if (accepts.length !== hunks.length) return { ok: false, error: 'accepts length mismatch' };
  const result = applyHunks(baseRes.base, hunks, accepts).join('\n');
  if (result === '' && baseRes.base.length === 0) {
    // A task-created file (empty base) fully rejected: the pre-task state is
    // ABSENT, so remove the file rather than write an empty one. (finding 3)
    unlinkSync(abs);
  } else {
    writeFileSync(abs, result);
  }
  return { ok: true };
}

// diff.read lets the renderer mount the DiffPanel: it resolves the same base as
// applyDiffToFile and returns base + modified + whether they differ, without
// applying anything.
export function readDiffFile(wsRoot: string, path: string, taskId: string, snapshotStore: SnapshotStore): { ok: true; base: string; modified: string; changed: boolean } | { ok: false; error: string } {
  const abs = join(wsRoot, path);
  if (!existsSync(abs)) return { ok: false, error: 'file not found' };
  const modified = toLines(readFileSync(abs, 'utf8'));
  const baseRes = resolveDiffBase(wsRoot, path, taskId, snapshotStore);
  if ('error' in baseRes) return { ok: false, error: baseRes.error };
  const baseText = baseRes.base.join('\n');
  const modifiedText = modified.join('\n');
  return { ok: true, base: baseText, modified: modifiedText, changed: baseText !== modifiedText };
}

// M4 Task 9 (E12): external IDE bridge /diff support. The bridge only receives a
// taskId, so this walks the (single-active) workspace and returns the FIRST file
// whose current content differs from the task's base (snapshot first, then git
// HEAD, then empty — the same resolveDiffBase contract as diff.applyAll). It is
// best-effort: multi-file tasks return the first changed file, and a task with
// no resolvable base change returns null (the bridge 404s). The walk reuses
// walkWorkspaceFiles, so hidden dirs (.git/.jarvis) and node_modules are never
// compared.
export function loadTaskDiff(wsRoot: string | null, taskId: string, snapshotStore: SnapshotStore): { path: string; diff: string } | null {
  if (!wsRoot) return null;
  const root = wsRoot.replace(/[\\/]+$/, '');
  for (const abs of walkWorkspaceFiles(root)) {
    const rel = abs.slice(root.length + 1);
    const baseRes = resolveDiffBase(root, rel, taskId, snapshotStore);
    if ('error' in baseRes) continue;
    let modified: string;
    try { modified = readFileSync(abs, 'utf8'); } catch { continue; }
    const modifiedLines = toLines(modified);
    if (baseRes.base.join('\n') === modifiedLines.join('\n')) continue;
    return { path: rel, diff: toUnified(groupHunks(diffLines(baseRes.base, modifiedLines))) };
  }
  return null;
}


