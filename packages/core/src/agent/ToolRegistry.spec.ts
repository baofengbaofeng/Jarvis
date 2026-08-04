import { describe, it, expect } from 'vitest';
import { ToolRegistry } from './ToolRegistry';

describe('ToolRegistry', () => {
  it('registers and lists tools', () => {
    const reg = new ToolRegistry();
    reg.register({ name: 'echo', description: 'echo input', parameters: { type: 'object', properties: { text: { type: 'string' } } } }, async () => ({ ok: true, output: '' }));
    expect(reg.list().map(t => t.name)).toContain('echo');
  });

  it('executes tool handler with args and context', async () => {
    const reg = new ToolRegistry();
    reg.register({ name: 'echo', description: '', parameters: {} }, async (args, ctx) => ({ ok: true, output: `${ctx.cwd}:${args.text}` }));
    const r = await reg.execute({ id: 't1', name: 'echo', arguments: { text: 'hi' } }, { cwd: '/tmp', env: {} });
    expect(r.output).toBe('/tmp:hi');
  });

  it('throws on unknown tool', async () => {
    const reg = new ToolRegistry();
    await expect(reg.execute({ id: 't2', name: 'nope', arguments: {} }, { cwd: '/', env: {} })).rejects.toThrow('unknown tool');
  });
});
