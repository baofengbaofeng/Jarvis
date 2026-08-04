import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolRegistry } from '../agent/ToolRegistry';
import type { ToolDef, ToolContext, ToolResult } from '../agent/types';
import vm from 'node:vm';

export interface PluginHostDeps { readImpl?: (p: string) => string }

export function createPluginHost(registry: ToolRegistry, deps: PluginHostDeps = {}) {
  const read = deps.readImpl ?? ((p: string) => readFileSync(p, 'utf8'));

  const registerTool = (def: ToolDef, handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>): void => {
    registry.register(def, handler);
  };

  return {
    registerTool,
    load(pluginDir: string): void {
      const entry = join(pluginDir, 'index.js');
      const code = read(entry);
      const sandbox = { registerTool, console };
      vm.createContext(sandbox);
      vm.runInContext(code, sandbox, { filename: entry });
    }
  };
}
