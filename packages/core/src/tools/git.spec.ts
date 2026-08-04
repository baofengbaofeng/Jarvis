import { describe, it, expect } from 'vitest';
import { createGitTools } from './git';
import { ToolRegistry } from '../agent/ToolRegistry';

describe('git tools', () => {
  it('runs git status within workspace', async () => {
    const reg = new ToolRegistry();
    const policy = { level: 'readwrite' as const, allowDomains: [], allowCommands: [] };
    createGitTools(reg, policy, { execImpl: async (_cmd: string) => ({ stdout: '## main', stderr: '' }) });
    const r = await reg.execute({ id: '1', name: 'git_status', arguments: {} }, { cwd: '/ws', env: {}, workspaceRoot: '/ws' });
    expect(r.output).toContain('main');
  });

  it('rejects a workspace outside the per-execution sandbox root', async () => {
    const reg = new ToolRegistry();
    const policy = { level: 'readwrite' as const, allowDomains: [], allowCommands: [] };
    createGitTools(reg, policy, { execImpl: async (_cmd: string) => ({ stdout: '', stderr: '' }) });
    // The execution ctx points at /ws but the tool runs with cwd=/outside; the
    // per-execution sandbox rooted at ctx.workspaceRoot must reject it.
    await expect(
      reg.execute({ id: '1', name: 'git_status', arguments: {} }, { cwd: '/outside', env: {}, workspaceRoot: '/ws' })
    ).rejects.toThrow('outside workspace');
  });
});
