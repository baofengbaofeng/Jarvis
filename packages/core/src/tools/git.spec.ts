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
  const policy: SandboxPolicy = { level: 'readwrite', allowDomains: [], allowCommands: ['git status'] };
  const reg = new ToolRegistry();

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'jarvis-git-ws-'));
    outside = mkdtempSync(join(tmpdir(), 'jarvis-git-out-'));
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
    await expect(
      reg.execute({ id: '1', name: 'git_status', arguments: {} }, { cwd: outside, env: {}, workspaceRoot: ws })
    ).rejects.toThrow('outside workspace');
  });

  it('blocks mutating git tools in readonly sandbox (CORE-12)', async () => {
    const ro = new ToolRegistry();
    createGitTools(ro, { level: 'readonly', allowDomains: [], allowCommands: [] }, {
      execImpl: async () => ({ stdout: 'should-not-run', stderr: '' }),
    });
    await expect(
      ro.execute({ id: '1', name: 'git_add', arguments: { path: '.' } }, { cwd: ws, env: {}, workspaceRoot: ws })
    ).rejects.toThrow('not allowed');
    await expect(
      ro.execute({ id: '2', name: 'git_commit', arguments: { message: 'x' } }, { cwd: ws, env: {}, workspaceRoot: ws })
    ).rejects.toThrow('not allowed');
    const status = await ro.execute(
      { id: '3', name: 'git_status', arguments: {} },
      { cwd: ws, env: {}, workspaceRoot: ws },
    );
    expect(status.output).toContain('should-not-run');
  });
});
