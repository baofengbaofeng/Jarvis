import { describe, it, expect } from 'vitest';
import { createPluginHost } from './PluginHost';
import { ToolRegistry } from '../agent/ToolRegistry';

describe('PluginHost', () => {
  it('registers tool from plugin code', async () => {
    const reg = new ToolRegistry();
    const host = createPluginHost(reg, { readImpl: () => `registerTool({ name: 'my_tool', description: '', parameters: {} }, async () => ({ ok: true, output: 'hi' }));` });
    host.load('/plugins/p1');
    const r = await reg.execute({ id: '1', name: 'my_tool', arguments: {} }, { cwd: '/', env: {} });
    expect(r.output).toBe('hi');
  });
});
