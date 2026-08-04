import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { createTaskSnapshot, type SnapshotGit, type SnapshotFs, type SnapshotMeta, type SnapshotStore } from '@jarvis/core';
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
