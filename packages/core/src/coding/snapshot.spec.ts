import { describe, it, expect } from 'vitest';
import { createTaskSnapshot, restoreSnapshot, type SnapshotGit, type SnapshotFs, type SnapshotMeta, type SnapshotStore } from './snapshot';

class MemFs implements SnapshotFs {
  files = new Map<string, string>();
  exists(p: string) { return this.files.has(p); }
  read(p: string) { return this.files.get(p) ?? null; }
  write(p: string, c: string) { this.files.set(p, c); }
  mkdir(p: string) { this.files.set(p + '/', ''); }
  walk(p: string) { return [...this.files.keys()].filter(k => k.startsWith(p) && !k.endsWith('/')); }
}

describe('TaskSnapshot', () => {
  // SnapshotStore (save/get) per snapshot.ts interfaces; backed by a Map so the
  // no-snapshot case returns null rather than undefined.
  const storeMap = new Map<string, SnapshotMeta>();
  const store: SnapshotStore = {
    save: (t, m) => { storeMap.set(t, m); },
    get: (t) => storeMap.get(t) ?? null
  };

  it('snapshots a git workspace as a patch and restores via reverse apply', async () => {
    const git: SnapshotGit = { exec: async (args) => ({ stdout: args[0] === 'diff' ? 'patch-data' : '', stderr: '' }) };
    const fs = new MemFs();
    fs.write('/ws/a.txt', 'v1');
    await createTaskSnapshot({ taskId: 't1', workspaceRoot: '/ws', git, fs, store, isGitRepo: true });
    expect(fs.read('/ws/.jarvis/snapshots/t1.patch')).toBe('patch-data');
    expect(store.get('t1')?.kind).toBe('git');
    // Reverse-apply restore must resolve without throwing. (git.exec is async,
    // so a bare expect(fn).not.toThrow() would call it with no args and leak an
    // unhandled rejection; assert on the awaited restore instead.)
    await expect(restoreSnapshot({ taskId: 't1', workspaceRoot: '/ws', git, fs, store })).resolves.toBeUndefined();
  });

  it('copy-on-write snapshots non-git workspaces and skips node_modules', async () => {
    const git: SnapshotGit = { exec: async () => ({ stdout: '', stderr: '' }) };
    const fs = new MemFs();
    fs.write('/ws/a.txt', 'v1');
    fs.write('/ws/node_modules/x.js', 'big');
    await createTaskSnapshot({ taskId: 't2', workspaceRoot: '/ws', git, fs, store, isGitRepo: false });
    const meta = store.get('t2')!;
    expect(meta.kind).toBe('copy');
    if (meta.kind === 'copy') {
      expect(meta.files['a.txt']).toBe('v1');
      expect(meta.files['node_modules/x.js']).toBeUndefined();
      fs.write('/ws/a.txt', 'v2'); // 改动后回滚
      await restoreSnapshot({ taskId: 't2', workspaceRoot: '/ws', git, fs, store });
      expect(fs.read('/ws/a.txt')).toBe('v1');
    }
  });

  it('throws when restoring a task with no snapshot', async () => {
    await expect(restoreSnapshot({ taskId: 'nope', workspaceRoot: '/ws', git: { exec: async () => ({ stdout: '', stderr: '' }) }, fs: new MemFs(), store })).rejects.toThrow();
  });
});
