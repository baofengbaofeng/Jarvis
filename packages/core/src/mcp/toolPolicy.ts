export interface McpToolNamePolicy {
  allowedTools?: string[] | null;
  blockedTools?: string[];
}

/** Filter discovered MCP tool short names by allow/block lists. */
export function filterMcpToolNames(tools: string[], policy: McpToolNamePolicy): string[] {
  const blocked = new Set((policy.blockedTools ?? []).map((t) => t.trim()).filter(Boolean));
  let list = tools.filter((t) => !blocked.has(t));
  if (policy.allowedTools != null) {
    const allow = new Set(policy.allowedTools.map((t) => t.trim()).filter(Boolean));
    list = list.filter((t) => allow.has(t));
  }
  return list;
}

/**
 * Normalize auto-approve entries to registered tool ids `mcp:{server}:{tool}`.
 * Bare tool names become `mcp:serverName:name`; already-prefixed ids pass through.
 */
export function normalizeAutoApprove(serverName: string, names: string[] | undefined): string[] {
  if (!names?.length) return [];
  const prefix = `mcp:${serverName}:`;
  return names
    .map((n) => n.trim())
    .filter(Boolean)
    .map((n) => (n.startsWith('mcp:') ? n : `${prefix}${n}`));
}
