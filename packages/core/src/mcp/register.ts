import type { McpClient } from './McpClient';
import type { ToolRegistry } from '../agent/ToolRegistry';

export async function registerMcpTools(registry: ToolRegistry, client: McpClient, serverName: string): Promise<void> {
  const tools = await client.listTools();
  for (const t of tools) {
    const fullName = `mcp:${serverName}:${t.name}`;
    registry.register({ name: fullName, description: t.description, parameters: t.inputSchema }, async (args) => {
      const out = await client.callTool(t.name, args);
      return { ok: true, output: out };
    });
  }
}
