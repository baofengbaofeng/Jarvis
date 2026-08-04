export interface SnapshotGit { exec(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> }
export interface SnapshotFs {
  exists(p: string): boolean;
  read(p: string): string | null;
  write(p: string, c: string): void;
  mkdir(p: string): void;
  walk(p: string): string[];
}
export type SnapshotMeta =
  | { kind: 'git'; patchFile: string }
  | { kind: 'copy'; dir: string; files: Record<string, string> };
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
    const { stdout } = await git.exec(['diff'], workspaceRoot);
    fs.mkdir(snapDir);
    const patchFile = `${snapDir}/${taskId}.patch`;
    fs.write(patchFile, stdout);
    store.save(taskId, { kind: 'git', patchFile });
  } else {
    const dir = `${snapDir}/${taskId}`;
    fs.mkdir(dir);
    const files: Record<string, string> = {};
    for (const p of fs.walk(workspaceRoot)) {
      const rel = p.slice(workspaceRoot.length + 1);
      if (rel.startsWith('.jarvis/') || rel.startsWith('node_modules/')) continue;
      const c = fs.read(p);
      if (c === null) continue;
      files[rel] = c;
      fs.write(`${dir}/${rel}`, c);
    }
    store.save(taskId, { kind: 'copy', dir, files });
  }
}

export async function restoreSnapshot(opts: Omit<CreateSnapshotOpts, 'isGitRepo'>): Promise<void> {
  const meta = opts.store.get(opts.taskId);
  if (!meta) throw new SnapshotError(`no snapshot for task ${opts.taskId}`);
  if (meta.kind === 'git') {
    const { stderr } = await opts.git.exec(['apply', '-R', meta.patchFile], opts.workspaceRoot);
    if (stderr) throw new SnapshotError(stderr);
  } else {
    for (const [rel, content] of Object.entries(meta.files)) {
      opts.fs.write(`${opts.workspaceRoot}/${rel}`, content);
    }
  }
}
