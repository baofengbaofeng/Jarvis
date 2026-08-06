import type { ToolRegistry } from '../agent/ToolRegistry';
import type { ToolContext, ToolResult } from '../agent/types';
import type { PluginDescriptor, RegisteredPluginTool } from './protocol';

export type { PluginDescriptor, RegisteredPluginTool } from './protocol';
export * from './protocol';

export interface PluginRunner {
  load(descriptor: PluginDescriptor): Promise<RegisteredPluginTool[]>;
  invoke(pluginId: string, tool: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
  close(pluginId: string): Promise<void>;
}

export function createPluginHost(registry: ToolRegistry, runner: PluginRunner) {
  return {
    async load(descriptor: PluginDescriptor): Promise<void> {
      for (const tool of await runner.load(descriptor)) {
        registry.register(tool.definition, (args, ctx) =>
          runner.invoke(descriptor.manifest.id, tool.definition.name, args, ctx));
      }
    },
  };
}
