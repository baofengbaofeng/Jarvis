import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { createMcpClient, type SpawnImpl } from '@jarvis/core';

export interface McpServerInput {
  name: string;
  transport: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  configJson?: string;
  // G6: agents this server is bound to; persisted into config_json.agentIds.
  agentIds?: string[];
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
    remove(id: string) { db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id); }
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
