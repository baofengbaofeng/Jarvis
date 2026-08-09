import type { McpClient } from './McpClient';
import type { ToolRegistry } from '../agent/ToolRegistry';
import { createSemaphore } from './concurrency';
import { filterMcpToolNames } from './toolPolicy';

export interface RegisterMcpToolsOpts {
  maxConcurrent?: number;
  toolWarningThreshold?: number;
  logWarn?: (msg: string) => void;
  allowedTools?: string[] | null;
  blockedTools?: string[];
}

export async function registerMcpTools(
  registry: ToolRegistry,
  client: McpClient,
  serverName: string,
  opts: RegisterMcpToolsOpts = {},
): Promise<void> {
  const tools = await client.listTools();
  const names = filterMcpToolNames(tools.map((t) => t.name), {
    allowedTools: opts.allowedTools,
    blockedTools: opts.blockedTools,
  });
  const allow = new Set(names);
  const sem = createSemaphore(opts.maxConcurrent ?? 8);
  const threshold = opts.toolWarningThreshold ?? 10_000;

  for (const t of tools) {
    if (!allow.has(t.name)) continue;
    const fullName = `mcp:${serverName}:${t.name}`;
    // CORE-07: shared registry + client cache may re-enter; skip duplicates.
    if (registry.has(fullName)) continue;
    registry.register({ name: fullName, description: t.description, parameters: t.inputSchema }, async (args) => {
      return sem.run(async () => {
        const out = await client.callTool(t.name, args);
        if (out.length > threshold) {
          opts.logWarn?.(`mcp tool output exceeds warning threshold (${out.length} > ${threshold}): ${fullName}`);
        }
        return { ok: true, output: out };
      });
    });
  }
}
