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
    const git: SnapshotGit = {
      exec: async (args) => ({
        stdout: args[0] === 'diff' && args.length === 1 ? 'patch-data' : '',
        stderr: ''
      })
    };
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

  it('git snapshots capture pre-task content of modified/untracked files and restore writes it back', async () => {
    const git: SnapshotGit = {
      exec: async (args) => {
        if (args[0] === 'diff' && args[1] === '--name-only') return { stdout: 'mod.ts\n', stderr: '' };
        if (args[0] === 'ls-files') return { stdout: 'new.ts\n', stderr: '' };
        return { stdout: 'patch-data', stderr: '' }; // ['diff'] and ['apply','-R',...]
      }
    };
    const fs = new MemFs();
    fs.write('/ws/mod.ts', 'v1-mod');
    fs.write('/ws/new.ts', 'v1-new');
    await createTaskSnapshot({ taskId: 't3', workspaceRoot: '/ws', git, fs, store, isGitRepo: true });
    const meta = store.get('t3')!;
    expect(meta.kind).toBe('git');
    if (meta.kind === 'git') {
      // meta stores only relative paths; the pre-task content lives in the dir.
      expect(meta.files).toEqual(['mod.ts', 'new.ts']);
      expect(fs.read(`${meta.dir}/mod.ts`)).toBe('v1-mod');
      expect(fs.read(`${meta.dir}/new.ts`)).toBe('v1-new');
      // The task modifies both files; restore writes the pre-task content back.
      fs.write('/ws/mod.ts', 'v2-mod');
      fs.write('/ws/new.ts', 'v2-new');
      await restoreSnapshot({ taskId: 't3', workspaceRoot: '/ws', git, fs, store });
      expect(fs.read('/ws/mod.ts')).toBe('v1-mod');
      expect(fs.read('/ws/new.ts')).toBe('v1-new');
    }
  });

  it('git snapshots do not self-capture their own .jarvis/snapshots output', async () => {
    // workspace.bind creates .jarvis/ without a .gitignore, so git ls-files
    // --others lists our OWN snapshot output. The capture must skip .jarvis/
    // (mirroring copy mode) so later tasks never re-snapshot earlier ones.
    const git: SnapshotGit = {
      exec: async (args) => {
        if (args[0] === 'diff' && args[1] === '--name-only') return { stdout: '', stderr: '' };
        if (args[0] === 'ls-files') return { stdout: '.jarvis/JARVIS.md\n.jarvis/snapshots/t4.patch\nsrc/a.ts\n', stderr: '' };
        return { stdout: 'patch-data', stderr: '' }; // ['diff'] and ['apply','-R',...]
      }
    };
    const fs = new MemFs();
    fs.write('/ws/.jarvis/JARVIS.md', 'context');
    fs.write('/ws/.jarvis/snapshots/t4.patch', 'patch-data');
    fs.write('/ws/src/a.ts', 'v1');
    await createTaskSnapshot({ taskId: 't4', workspaceRoot: '/ws', git, fs, store, isGitRepo: true });
    const meta = store.get('t4')!;
    expect(meta.kind).toBe('git');
    if (meta.kind === 'git') {
      // Only the user's file is captured; .jarvis paths are filtered out.
      expect(meta.files).toEqual(['src/a.ts']);
      expect(fs.read(`${meta.dir}/src/a.ts`)).toBe('v1');
      // The .jarvis paths must NOT be written into the snapshot dir.
      expect(fs.read(`${meta.dir}/.jarvis/JARVIS.md`)).toBeNull();
      expect(fs.read(`${meta.dir}/.jarvis/snapshots/t4.patch`)).toBeNull();
    }
  });

  it('copy-on-write snapshots non-git workspaces and skips node_modules (paths only, content in dir)', async () => {
    const git: SnapshotGit = { exec: async () => ({ stdout: '', stderr: '' }) };
    const fs = new MemFs();
    fs.write('/ws/a.txt', 'v1');
    fs.write('/ws/node_modules/x.js', 'big');
    await createTaskSnapshot({ taskId: 't2', workspaceRoot: '/ws', git, fs, store, isGitRepo: false });
    const meta = store.get('t2')!;
    expect(meta.kind).toBe('copy');
    if (meta.kind === 'copy') {
      // meta.files is a bounded list of RELATIVE PATHS, not the file contents.
      expect(meta.files).toContain('a.txt');
      expect(meta.files).not.toContain('node_modules/x.js');
      expect(fs.read(`${meta.dir}/a.txt`)).toBe('v1');
      // The task changes the file; restore reads the content back from the dir.
      fs.write('/ws/a.txt', 'v2');
      await restoreSnapshot({ taskId: 't2', workspaceRoot: '/ws', git, fs, store });
      expect(fs.read('/ws/a.txt')).toBe('v1');
    }
  });

  it('restores a legacy git snapshot (no files/dir fields) via reverse apply only', async () => {
    // Pre-M4-review git rows were {kind:'git'; patchFile} with NO files list.
    // restoreSnapshot must not trip on the absent files field — the reverse-apply
    // patch alone restores the tracked state, and the write-back loop is a no-op.
    const git: SnapshotGit = { exec: async (args) => ({ stdout: args[0] === 'apply' ? '' : 'patch-data', stderr: '' }) };
    const fs = new MemFs();
    store.save('t-legacy', { kind: 'git', patchFile: '/ws/.jarvis/snapshots/t-legacy.patch' } as unknown as SnapshotMeta);
    await expect(restoreSnapshot({ taskId: 't-legacy', workspaceRoot: '/ws', git, fs, store })).resolves.toBeUndefined();
  });

  it('throws when restoring a task with no snapshot', async () => {
    await expect(restoreSnapshot({ taskId: 'nope', workspaceRoot: '/ws', git: { exec: async () => ({ stdout: '', stderr: '' }) }, fs: new MemFs(), store })).rejects.toThrow();
  });
});
