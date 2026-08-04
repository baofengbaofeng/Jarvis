import { describe, it, expect } from 'vitest';
import { createGitTools } from './git';
import { Sandbox } from '../sandbox/Sandbox';
import { ToolRegistry } from '../agent/ToolRegistry';

describe('git tools', () => {
  it('runs git status within workspace', async () => {
    const reg = new ToolRegistry();
    const sb = new Sandbox('/ws', { level: 'readwrite', allowDomains: [], allowCommands: [] });
    createGitTools(reg, sb, { execImpl: async (_cmd: string) => ({ stdout: '## main', stderr: '' }) });
    const r = await reg.execute({ id: '1', name: 'git_status', arguments: {} }, { cwd: '/ws', env: {} });
    expect(r.output).toContain('main');
  });
});
