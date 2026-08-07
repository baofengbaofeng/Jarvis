import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGitTools } from './git';
import type { SandboxPolicy } from '../sandbox/Sandbox';
import { ToolRegistry } from '../agent/ToolRegistry';

describe('git tools', () => {
  let ws: string;
  let outside: string;
  let reg: ToolRegistry;
  const policy: SandboxPolicy = { level: 'readwrite', allowDomains: [], allowCommands: ['git status'] };

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'jarvis-git-ws-'));
    outside = mkdtempSync(join(tmpdir(), 'jarvis-git-out-'));
    reg = new ToolRegistry();
    createGitTools(reg, policy, { execImpl: async () => ({ stdout: '## main', stderr: '' }) });
  });

  afterEach(() => {
    rmSync(ws, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('runs git status within workspace', async () => {
    const r = await reg.execute({ id: '1', name: 'git_status', arguments: {} }, { cwd: ws, env: {}, workspaceRoot: ws });
    expect(r.output).toContain('main');
  });

  it('rejects a workspace outside the per-execution sandbox root', async () => {
    // CORE-06: path denial is returned as ok:false so the model can recover.
    const r = await reg.execute({ id: '1', name: 'git_status', arguments: {} }, { cwd: outside, env: {}, workspaceRoot: ws });
    expect(r.ok).toBe(false);
    expect(r.output).toContain('outside workspace');
  });

  it('blocks mutating git tools in readonly sandbox (CORE-12)', async () => {
    const ro = new ToolRegistry();
    createGitTools(ro, { level: 'readonly', allowDomains: [], allowCommands: [] }, {
      execImpl: async () => ({ stdout: 'should-not-run', stderr: '' }),
    });
    const add = await ro.execute({ id: '1', name: 'git_add', arguments: { path: '.' } }, { cwd: ws, env: {}, workspaceRoot: ws });
    expect(add.ok).toBe(false);
    expect(add.output).toContain('not allowed');
    const commit = await ro.execute({ id: '2', name: 'git_commit', arguments: { message: 'x' } }, { cwd: ws, env: {}, workspaceRoot: ws });
    expect(commit.ok).toBe(false);
    expect(commit.output).toContain('not allowed');
    const status = await ro.execute(
      { id: '3', name: 'git_status', arguments: {} },
      { cwd: ws, env: {}, workspaceRoot: ws },
    );
    expect(status.output).toContain('should-not-run');
  });

  it('forwards AbortSignal and sets non-interactive git env (CORE-14)', async () => {
    const calls: Array<{ args: string[]; opts: { signal?: AbortSignal; env?: Record<string, string> } }> = [];
    const g = new ToolRegistry();
    createGitTools(g, policy, {
      execImpl: async (_cmd, args, _cwd, opts) => {
        calls.push({ args, opts: opts ?? {} });
        return { stdout: 'ok', stderr: '' };
      },
    });
    const ac = new AbortController();
    await g.execute(
      { id: '1', name: 'git_status', arguments: {} },
      { cwd: ws, env: { CUSTOM: '1' }, workspaceRoot: ws, signal: ac.signal },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.signal).toBe(ac.signal);
    expect(calls[0].opts.env?.GIT_TERMINAL_PROMPT).toBe('0');
    expect(calls[0].opts.env?.GIT_ASKPASS).toBe('echo');
    expect(calls[0].opts.env?.GCM_INTERACTIVE).toBe('never');
    expect(calls[0].opts.env?.CUSTOM).toBe('1');
  });
});
