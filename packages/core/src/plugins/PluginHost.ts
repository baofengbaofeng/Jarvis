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

/** CORE-07: plugin tools are namespaced so they cannot shadow builtins. */
export function pluginToolName(pluginId: string, toolName: string): string {
  if (toolName.startsWith('plugin:')) return toolName;
  return `plugin:${pluginId}:${toolName}`;
}

export function createPluginHost(registry: ToolRegistry, runner: PluginRunner) {
  return {
    async load(descriptor: PluginDescriptor): Promise<void> {
      const pluginId = descriptor.manifest.id;
      for (const tool of await runner.load(descriptor)) {
        const localName = tool.definition.name;
        const fullName = pluginToolName(pluginId, localName);
        registry.register(
          { ...tool.definition, name: fullName },
          (args, ctx) => runner.invoke(pluginId, localName, args, ctx),
        );
      }
    },
  };
}
