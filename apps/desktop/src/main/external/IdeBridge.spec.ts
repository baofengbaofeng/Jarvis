import { describe, it, expect, vi, afterEach } from 'vitest';
import { IdeBridge, parseFileArg, openInExternalIde, resolveFileInWorkspace } from './IdeBridge';

describe('parseFileArg', () => {
  it('parses path:line', () => {
    expect(parseFileArg('src/a.ts:12')).toEqual({ file: 'src/a.ts', line: 12 });
    expect(parseFileArg('src/a.ts')).toEqual({ file: 'src/a.ts', line: undefined });
  });
});

describe('openInExternalIde', () => {
  it('invokes cli with -g and line', () => {
    const cli = vi.fn();
    openInExternalIde(cli, 'src/a.ts', 12);
    expect(cli).toHaveBeenCalledWith(['-g', 'src/a.ts:12']);
  });

  it('invokes cli with the bare path when no line is given', () => {
    const cli = vi.fn();
    openInExternalIde(cli, 'src/a.ts');
    expect(cli).toHaveBeenCalledWith(['src/a.ts']);
  });
});

describe('resolveFileInWorkspace (E12 containment)', () => {
  it('resolves an in-workspace relative path to an absolute path', () => {
    expect(resolveFileInWorkspace('src/a.ts', '/ws')).toBe('/ws/src/a.ts');
  });
  it('rejects paths that escape the workspace root', () => {
    expect(resolveFileInWorkspace('../../etc/passwd', '/ws')).toBeNull();
    expect(resolveFileInWorkspace('/etc/passwd', '/ws')).toBeNull();
    expect(resolveFileInWorkspace('a/../../b.ts', '/ws')).toBeNull();
  });
});

describe('IdeBridge HTTP (DESK-05)', () => {
  it('rejects unauthenticated requests', async () => {
    const bridge = new IdeBridge({
      token: 'secret-token',
      resolveFile: () => '/ws/a.ts',
      resolveTaskDiff: () => ({ path: 'a.ts', diff: '' }),
    });
    const port = await bridge.start();
    const res = await fetch(`http://127.0.0.1:${port}/diff?task=t1`);
    expect(res.status).toBe(401);
    await bridge.close();
  });

  it('serves /open and /diff with bearer token', async () => {
    const bridge = new IdeBridge({
      token: 'secret-token',
      resolveFile: (f) => f === 'src/a.ts' ? `/ws/${f}` : null,
      resolveTaskDiff: (t) => t === 't1' ? { path: 'src/a.ts', diff: '@@ -1 +1 @@\n-const x = 1;\n+const x = 2;\n' } : null
    });
    const port = await bridge.start();
    const base = `http://127.0.0.1:${port}`;
    const headers = { Authorization: 'Bearer secret-token' };
    const openRes = await fetch(`${base}/open?file=src%2Fa.ts`, { headers }).then(r => r.json());
    expect(openRes).toEqual({ ok: true, path: '/ws/src/a.ts' });
    const diffRes = await fetch(`${base}/diff?task=t1`, { headers }).then(r => r.json());
    expect(diffRes.path).toBe('src/a.ts');
    await bridge.close();
  });
  afterEach(() => { vi.restoreAllMocks(); });
});
