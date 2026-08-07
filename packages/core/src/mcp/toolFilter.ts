/**
 * CORE-20: MCP tools are registered into a shared ToolRegistry (client cache),
 * but visibility/execution must stay run-scoped to the agent's bindings.
 */

export function isMcpToolName(name: string): boolean {
  return name.startsWith('mcp:');
}

/** Parse `mcp:{server}:{tool}` → server name, or null if not an MCP tool. */
export function mcpServerFromToolName(name: string): string | null {
  if (!name.startsWith('mcp:')) return null;
  const rest = name.slice('mcp:'.length);
  const idx = rest.indexOf(':');
  if (idx <= 0) return null;
  return rest.slice(0, idx);
}

/** Drop MCP tools whose server is not in the agent's binding set. */
export function filterToolsForMcpBindings(
  toolNames: string[],
  boundServerNames: ReadonlySet<string> | readonly string[],
): string[] {
  const bound = boundServerNames instanceof Set ? boundServerNames : new Set(boundServerNames);
  return toolNames.filter((name) => {
    const server = mcpServerFromToolName(name);
    if (server === null) return true;
    return bound.has(server);
  });
}

/** CORE-20: run-scoped predicate for EngineRunInput.toolFilter. */
export function createMcpToolFilter(
  boundServerNames: ReadonlySet<string> | readonly string[],
): (name: string) => boolean {
  const bound = boundServerNames instanceof Set ? boundServerNames : new Set(boundServerNames);
  return (name: string) => {
    const server = mcpServerFromToolName(name);
    if (server === null) return true;
    return bound.has(server);
  };
}
