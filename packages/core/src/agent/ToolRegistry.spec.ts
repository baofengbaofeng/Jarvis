import { describe, it, expect, vi } from 'vitest';
import { FatalToolError, ToolRegistry } from './ToolRegistry';
import { DelegateGuardError } from '../squad/Delegate';

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

  it('returns ok:false when the handler rejects instead of throwing (CORE-06)', async () => {
    const onExec = vi.fn();
    const reg = new ToolRegistry({ onExec });
    reg.register({ name: 'boom', description: '', parameters: {} }, async () => { throw new Error('handler failed'); });
    const r = await reg.execute({ id: 't4', name: 'boom', arguments: {} }, { cwd: '/', env: {} });
    expect(r).toEqual({ ok: false, output: 'handler failed' });
    expect(onExec).toHaveBeenCalledTimes(1);
    expect(onExec.mock.calls[0][0].result).toBe('error');
  });

  it('rethrows FatalToolError and DelegateGuardError (squad control-flow)', async () => {
    const reg = new ToolRegistry();
    reg.register({ name: 'fatal', description: '', parameters: {} }, async () => { throw new FatalToolError('member crashed'); });
    reg.register({ name: 'guard', description: '', parameters: {} }, async () => { throw new DelegateGuardError('members cannot delegate'); });
    await expect(reg.execute({ id: '1', name: 'fatal', arguments: {} }, { cwd: '/', env: {} })).rejects.toThrow('member crashed');
    await expect(reg.execute({ id: '2', name: 'guard', arguments: {} }, { cwd: '/', env: {} })).rejects.toThrow('members cannot delegate');
  });

  it('returns ok:false for an unknown tool instead of throwing (CORE-06)', async () => {
    const onExec = vi.fn();
    const reg = new ToolRegistry({ onExec });
    const r = await reg.execute({ id: 't5', name: 'nope', arguments: {} }, { cwd: '/', env: {} });
    expect(r.ok).toBe(false);
    expect(r.output).toContain('unknown tool');
    expect(onExec).toHaveBeenCalledTimes(1);
    expect(onExec.mock.calls[0][0].result).toBe('error');
  });

  // CORE-07: name conflicts must throw — silent overwrite lets plugins shadow builtins.
  it('throws when registering a duplicate tool name (CORE-07)', () => {
    const reg = new ToolRegistry();
    const handler = async () => ({ ok: true, output: 'a' });
    reg.register({ name: 'echo', description: '', parameters: {} }, handler);
    expect(() =>
      reg.register({ name: 'echo', description: 'shadow', parameters: {} }, async () => ({ ok: true, output: 'b' })),
    ).toThrow(/already registered|conflict/i);
    expect(reg.get('echo')?.description).toBe('');
  });

  it('unregister removes a tool so it can be registered again (CORE-07)', () => {
    const reg = new ToolRegistry();
    reg.register({ name: 'echo', description: '', parameters: {} }, async () => ({ ok: true, output: '' }));
    expect(reg.unregister('echo')).toBe(true);
    expect(reg.has('echo')).toBe(false);
    expect(reg.unregister('echo')).toBe(false);
    expect(() =>
      reg.register({ name: 'echo', description: 'again', parameters: {} }, async () => ({ ok: true, output: '' })),
    ).not.toThrow();
    expect(reg.get('echo')?.description).toBe('again');
  });
});
