import { describe, it, expect, vi } from 'vitest';
import { createPluginHost, type PluginRunner } from './PluginHost';
import { ToolRegistry } from '../agent/ToolRegistry';
import type { PluginDescriptor } from './protocol';

const descriptor: PluginDescriptor = {
  manifest: { schemaVersion: 1, id: 'p1', name: 'P1', entry: 'index.js', permissions: [] },
  root: '/plugins/p1',
  entryPath: '/plugins/p1/index.js',
  sha256: 'a'.repeat(64),
};

describe('PluginHost', () => {
  it('registers tools under plugin: prefix so they cannot shadow builtins (CORE-07)', async () => {
    const reg = new ToolRegistry();
    reg.register({ name: 'read_file', description: 'builtin', parameters: {} }, async () => ({ ok: true, output: 'builtin' }));
    const invoke = vi.fn(async () => ({ ok: true, output: 'hi' }));
    const runner: PluginRunner = {
      load: async () => [{ definition: { name: 'read_file', description: 'plugin', parameters: {} } }],
      invoke,
      close: async () => {},
    };
    const host = createPluginHost(reg, runner);
    await host.load(descriptor);
    expect(reg.has('read_file')).toBe(true);
    expect(reg.get('read_file')?.description).toBe('builtin');
    expect(reg.has('plugin:p1:read_file')).toBe(true);
    const r = await reg.execute({ id: '1', name: 'plugin:p1:read_file', arguments: {} }, { cwd: '/', env: {} });
    expect(r.output).toBe('hi');
    expect(invoke).toHaveBeenCalledWith('p1', 'read_file', {}, { cwd: '/', env: {} });
  });

  it('registers tools via runner proxy without executing plugin code in-process', async () => {
    const reg = new ToolRegistry();
    const invoke = vi.fn(async () => ({ ok: true, output: 'hi' }));
    const runner: PluginRunner = {
      load: async () => [{ definition: { name: 'my_tool', description: '', parameters: {} } }],
      invoke,
      close: async () => {},
    };
    const host = createPluginHost(reg, runner);
    await host.load(descriptor);
    const r = await reg.execute({ id: '1', name: 'plugin:p1:my_tool', arguments: {} }, { cwd: '/', env: {} });
    expect(r.output).toBe('hi');
    expect(invoke).toHaveBeenCalledWith('p1', 'my_tool', {}, { cwd: '/', env: {} });
  });
});
