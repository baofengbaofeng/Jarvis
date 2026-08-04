import { describe, it, expect } from 'vitest';
import { createFileTools } from './file';
import type { SandboxPolicy } from '../sandbox/Sandbox';
import { ToolRegistry } from '../agent/ToolRegistry';

describe('file tools', () => {
  const files = new Map<string, string>([['/ws/a.txt', 'hello']]);
  const fsImpl = {
    readFileSync: (p: string) => files.get(p) ?? '',
    writeFileSync: (p: string, c: string) => { files.set(p, c); },
    readdirSync: (p: string) => p === '/ws' ? ['a.txt'] : []
  };
  const policy: SandboxPolicy = { level: 'readwrite', allowDomains: [], allowCommands: [] };
  const reg = new ToolRegistry();
  const ctx = { cwd: '/ws', env: {}, workspaceRoot: '/ws' };

  it('reads file inside workspace', async () => {
    createFileTools(reg, policy, fsImpl);
    const r = await reg.execute({ id: '1', name: 'read_file', arguments: { path: '/ws/a.txt' } }, ctx);
    expect(r.output).toContain('hello');
  });

  it('writes file inside workspace', async () => {
    await reg.execute({ id: '2', name: 'write_file', arguments: { path: '/ws/b.txt', content: 'new' } }, ctx);
    expect(files.get('/ws/b.txt')).toBe('new');
  });

  it('rejects write outside workspace', async () => {
    await expect(reg.execute({ id: '3', name: 'write_file', arguments: { path: '/etc/passwd', content: 'x' } }, ctx))
      .rejects.toThrow('outside workspace');
  });
});
