import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { createMcpClient, registerMcpTools, type McpClient, type SpawnImpl, type ToolRegistry } from '@jarvis/core';

export interface McpServerInput {
  name: string;
  transport: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  configJson?: string;
  // G6: agents this server is bound to; persisted into config_json.agentIds.
  agentIds?: string[];
}

// MCP client cache: createStdioTransport spawns the OS process eagerly at
// construction, so a fresh client per task run would leak an orphaned child
// process every time. Tool handlers close over their client, so we cache ONE
// client per server id: spawn + initialize + register once, reuse thereafter.
// Clients are closed on server delete (createMcpStore.remove) or app teardown
// (closeAllMcpClients, wired into the main process 'will-quit' hook).
const mcpClientCache = new Map<string, { client: McpClient; serverName: string }>();

export function closeMcpClient(serverId: string): void {
  const entry = mcpClientCache.get(serverId);
  if (entry) {
    try { entry.client.close(); } catch { /* ignore */ }
    mcpClientCache.delete(serverId);
  }
}

export function closeAllMcpClients(): void {
  for (const id of [...mcpClientCache.keys()]) closeMcpClient(id);
}

export function createMcpStore(db: Database.Database) {
  return {
    list() {
      return (db.prepare('SELECT * FROM mcp_servers ORDER BY created_at').all() as Record<string, unknown>[]).map(r => ({
        id: r.id as string, name: r.name as string, transport: r.transport as string, config: JSON.parse((r.config_json as string) ?? '{}')
      }));
    },
    create(input: McpServerInput) {
      const id = randomUUID();
      db.prepare('INSERT INTO mcp_servers (id, name, transport, config_json, created_at) VALUES (?,?,?,?,?)')
        .run(id, input.name, input.transport, JSON.stringify({ command: input.command, args: input.args, config: input.configJson, agentIds: input.agentIds ?? [] }), new Date().toISOString());
      return this.list().find(s => s.id === id)!;
    },
    remove(id: string) {
      db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
      // Stop the child process if this server was ever registered with the engine.
      closeMcpClient(id);
    }
  };
}

// G7: connectivity probe behind the settings page "Test" button. Spawns the
// server via createMcpClient, runs initialize + tools/list, and reports the
// discovered tool names (or an error) without persisting anything.
export async function testMcpServer(input: McpServerInput, deps: { spawnImpl?: SpawnImpl } = {}): Promise<{ ok: boolean; tools: string[]; error?: string }> {
  if (input.transport !== 'stdio') return { ok: false, tools: [], error: `transport ${input.transport} not supported for test` };
  const client = createMcpClient(input.command ?? '', input.args ?? [], input.name, deps);
  try {
    await client.initialize();
    const tools = await client.listTools();
    return { ok: true, tools: tools.map(t => t.name) };
  } catch (e) {
    return { ok: false, tools: [], error: e instanceof Error ? e.message : String(e) };
  } finally {
    client.close();
  }
}

export interface McpRegistrationDeps { spawnImpl?: SpawnImpl }

// G6: spawn each MCP server bound to the agent (config_json.agentIds) and
// register its tools into the engine registry under mcp:{server}:{tool}.
// stdio is the only transport createMcpClient supports today; sse/http are
// deferred. The client is cached per server id so subsequent task runs reuse
// the same child process instead of leaking one per run; a config change after
// first registration requires an app restart (documented in the task report).
export async function registerAgentMcpTools(db: Database.Database, toolRegistry: ToolRegistry, agentId: string, deps: McpRegistrationDeps = {}): Promise<void> {
  const rows = db.prepare('SELECT id, name, transport, config_json FROM mcp_servers').all() as Array<{ id: string; name: string; transport: string; config_json: string }>;
  for (const s of rows) {
    const cfg = JSON.parse(s.config_json ?? '{}') as { command?: string; args?: string[]; agentIds?: string[] };
    if (s.transport !== 'stdio' || !cfg.command || !cfg.agentIds?.includes(agentId)) continue;
    if (mcpClientCache.has(s.id)) continue; // already spawned + registered
    try {
      const client = createMcpClient(cfg.command, cfg.args ?? [], s.name, deps);
      await client.initialize();
      await registerMcpTools(toolRegistry, client, s.name);
      mcpClientCache.set(s.id, { client, serverName: s.name });
    } catch (e) {
      console.error(`mcp: failed to register server ${s.name}`, e);
    }
  }
}
