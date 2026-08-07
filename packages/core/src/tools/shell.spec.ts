import { describe, it, expect } from 'vitest';
import { createShellTool } from './shell';
import type { SandboxPolicy } from '../sandbox/Sandbox';
import { ToolRegistry } from '../agent/ToolRegistry';

describe('shell tool', () => {
  const policy: SandboxPolicy = { level: 'readwrite', allowDomains: [], allowCommands: ['ls'] };

  it('runs whitelisted command', async () => {
    const reg = new ToolRegistry();
    createShellTool(reg, policy, { execImpl: async () => ({ stdout: 'a.txt', stderr: '' }) });
    const r = await reg.execute({ id: '1', name: 'run_shell', arguments: { command: 'ls -la' } }, { cwd: '/ws', env: {}, workspaceRoot: '/ws' });
    expect(r.output).toContain('a.txt');
  });
  it('blocks disallowed command via sandbox', async () => {
    const reg = new ToolRegistry();
    createShellTool(reg, policy, { execImpl: async () => ({ stdout: '', stderr: '' }) });
    // CORE-06: sandbox denial is returned as ok:false so the model can recover.
    const r = await reg.execute({ id: '1', name: 'run_shell', arguments: { command: 'rm -rf /' } }, { cwd: '/ws', env: {}, workspaceRoot: '/ws' });
    expect(r.ok).toBe(false);
    expect(r.output).toContain('not allowed');
  });

  it('forwards AbortSignal to execImpl (CORE-14)', async () => {
    const reg = new ToolRegistry();
    const seen: Array<{ signal?: AbortSignal }> = [];
    createShellTool(reg, policy, {
      execImpl: async (_cmd, opts) => {
        seen.push({ signal: opts.signal });
        return { stdout: 'ok', stderr: '' };
      },
    });
    const ac = new AbortController();
    await reg.execute(
      { id: '1', name: 'run_shell', arguments: { command: 'ls' } },
      { cwd: '/ws', env: {}, workspaceRoot: '/ws', signal: ac.signal },
    );
    expect(seen[0]?.signal).toBe(ac.signal);
  });

  it('returns ok:false when AbortSignal aborts the shell command (CORE-14)', async () => {
    const reg = new ToolRegistry();
    createShellTool(reg, policy, {
      execImpl: async (_cmd, opts) => {
        if (opts.signal?.aborted) {
          const err = new Error('aborted');
          err.name = 'AbortError';
          throw err;
        }
        return new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      },
    });
    const ac = new AbortController();
    const p = reg.execute(
      { id: '1', name: 'run_shell', arguments: { command: 'ls' } },
      { cwd: '/ws', env: {}, workspaceRoot: '/ws', signal: ac.signal },
    );
    ac.abort();
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.output.toLowerCase()).toMatch(/abort/);
  });
});
