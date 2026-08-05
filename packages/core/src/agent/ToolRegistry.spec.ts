import { describe, it, expect, vi } from 'vitest';
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

  // J5 (M8 Task 3): the onExec hook fires with result 'ok' after a successful
  // read_file-style execution.
  it('fires onExec with ok after a successful execution', async () => {
    const onExec = vi.fn();
    const reg = new ToolRegistry({ onExec });
    reg.register({ name: 'read_file', description: '', parameters: {} }, async (args) => ({ ok: true, output: `content of ${args.path}` }));
    const r = await reg.execute({ id: 't3', name: 'read_file', arguments: { path: 'a.txt' } }, { cwd: '/', env: {} });
    expect(r.ok).toBe(true);
    expect(onExec).toHaveBeenCalledTimes(1);
    const e = onExec.mock.calls[0][0] as { ts: number; tool: string; result: string; args: unknown };
    expect(e.tool).toBe('read_file');
    expect(e.result).toBe('ok');
    expect(e.args).toEqual({ path: 'a.txt' });
    expect(typeof e.ts).toBe('number');
  });

  it('fires onExec with error before re-throwing when the handler rejects', async () => {
    const onExec = vi.fn();
    const reg = new ToolRegistry({ onExec });
    reg.register({ name: 'boom', description: '', parameters: {} }, async () => { throw new Error('handler failed'); });
    await expect(reg.execute({ id: 't4', name: 'boom', arguments: {} }, { cwd: '/', env: {} })).rejects.toThrow('handler failed');
    expect(onExec).toHaveBeenCalledTimes(1);
    expect(onExec.mock.calls[0][0].result).toBe('error');
  });

  it('fires onExec with error for an unknown tool before re-throwing', async () => {
    const onExec = vi.fn();
    const reg = new ToolRegistry({ onExec });
    await expect(reg.execute({ id: 't5', name: 'nope', arguments: {} }, { cwd: '/', env: {} })).rejects.toThrow('unknown tool');
    expect(onExec).toHaveBeenCalledTimes(1);
    expect(onExec.mock.calls[0][0].result).toBe('error');
  });
});
