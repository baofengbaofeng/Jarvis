export interface SnapshotGit { exec(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> }
export interface SnapshotFs {
  exists(p: string): boolean;
  read(p: string): string | null;
  write(p: string, c: string): void;
  mkdir(p: string): void;
  walk(p: string): string[];
}
// M4 final review (findings 2 & 4): both kinds store only RELATIVE PATHS in
// meta.files and keep the file CONTENTS in the snapshot dir ({dir}/{rel}). The
// pre-review format stored Record<string,string> (path -> content) inline in
// meta.files, which JSON.stringify'd the whole workspace into
// task_snapshots.meta_json (unbounded; a real RangeError was hit on a big
// non-git workspace). restoreSnapshot and resolveDiffBase read both shapes for
// backward compatibility.
export type SnapshotMeta =
  | { kind: 'git'; patchFile: string; dir: string; files: string[] }
  | { kind: 'copy'; dir: string; files: string[] };
export interface SnapshotStore { save(taskId: string, meta: SnapshotMeta): void; get(taskId: string): SnapshotMeta | null }

export class SnapshotError extends Error {}

export const SNAPSHOT_DIR = '.jarvis/snapshots';

export interface CreateSnapshotOpts {
  taskId: string; workspaceRoot: string; git: SnapshotGit; fs: SnapshotFs;
  store: SnapshotStore; isGitRepo: boolean;
}

export async function createTaskSnapshot(opts: CreateSnapshotOpts): Promise<void> {
  const { taskId, workspaceRoot, git, fs, store, isGitRepo } = opts;
  const snapDir = `${workspaceRoot}/${SNAPSHOT_DIR}`;
  if (isGitRepo) {
    // The reverse-applied patch reverts the task's TRACKED changes. `git diff`
    // (working tree vs index) at snapshot time represents the user's UNCOMMITTED
    // pre-task edits; reversing it on rollback would throw those edits away. So
    // we ALSO capture the pre-task content of every dirty/untracked file and
    // write it back on restore — restoring the exact pre-task working tree (L26)
    // and giving resolveDiffBase a pre-task base for the E9 diff (finding 4).
    const { stdout } = await git.exec(['diff'], workspaceRoot);
    fs.mkdir(snapDir);
    const patchFile = `${snapDir}/${taskId}.patch`;
    fs.write(patchFile, stdout);
    const dir = `${snapDir}/${taskId}`;
    fs.mkdir(dir);
    const files: string[] = [];
    // Union of tracked-modified/deleted files (git diff --name-only) and
    // untracked files (git ls-files --others). These are the only paths where
    // the pre-task working state differs from HEAD/index, so they are the ones
    // the diff base (E9) and rollback (L26) must restore. Files the task CREATES
    // are absent here by definition — they get an empty diff base instead.
    const [{ stdout: modified }, { stdout: untracked }] = await Promise.all([
      git.exec(['diff', '--name-only'], workspaceRoot),
      git.exec(['ls-files', '--others', '--exclude-standard'], workspaceRoot)
    ]);
    const rels = new Set([...modified.split('\n'), ...untracked.split('\n')].filter(Boolean));
    for (const rel of rels) {
      const content = fs.read(`${workspaceRoot}/${rel}`);
      if (content === null) continue; // deleted pre-task: nothing to restore
      files.push(rel);
      fs.write(`${dir}/${rel}`, content);
    }
    store.save(taskId, { kind: 'git', patchFile, dir, files });
  } else {
    const dir = `${snapDir}/${taskId}`;
    fs.mkdir(dir);
    // Copy snapshot: keep writing each file's content to {dir}/{rel}, but store
    // only the RELATIVE PATH in meta.files so task_snapshots.meta_json stays
    // bounded no matter how large the (non-git) workspace is. (finding 2)
    const files: string[] = [];
    for (const p of fs.walk(workspaceRoot)) {
      const rel = p.slice(workspaceRoot.length + 1);
      if (rel.startsWith('.jarvis/') || rel.startsWith('node_modules/')) continue;
      const c = fs.read(p);
      if (c === null) continue;
      files.push(rel);
      fs.write(`${dir}/${rel}`, c);
    }
    store.save(taskId, { kind: 'copy', dir, files });
  }
}

// M4 final review: rows written before the fix inlined file contents as
// Record<string,string> in meta.files. New rows store an ordered list of
// relative paths with the content in the snapshot dir. These helpers read both
// shapes so restore and the diff base work across the migration boundary.
function snapshotRels(meta: SnapshotMeta): string[] {
  // Legacy git rows predate the files field entirely ({kind:'git';patchFile});
  // there is nothing to write back for them — the reverse-apply patch is enough.
  if (!meta.files) return [];
  if (Array.isArray(meta.files)) return meta.files;
  return Object.keys(meta.files as unknown as Record<string, string>);
}

export async function restoreSnapshot(opts: Omit<CreateSnapshotOpts, 'isGitRepo'>): Promise<void> {
  const meta = opts.store.get(opts.taskId);
  if (!meta) throw new SnapshotError(`no snapshot for task ${opts.taskId}`);
  if (meta.kind === 'git') {
    const { stderr } = await opts.git.exec(['apply', '-R', meta.patchFile], opts.workspaceRoot);
    if (stderr) throw new SnapshotError(stderr);
  }
  // Write the pre-task content back for every captured path (git kind: dirty
  // tracked + untracked; copy kind: the whole workspace minus ignores). Legacy
  // rows carried the content inline; new rows keep it in the snapshot dir.
  for (const rel of snapshotRels(meta)) {
    if (!Array.isArray(meta.files) && meta.files) {
      const legacy = (meta.files as unknown as Record<string, string>)[rel];
      if (typeof legacy === 'string') { opts.fs.write(`${opts.workspaceRoot}/${rel}`, legacy); continue; }
    }
    const content = opts.fs.read(`${meta.dir}/${rel}`);
    if (content !== null) opts.fs.write(`${opts.workspaceRoot}/${rel}`, content);
  }
}
