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
});
