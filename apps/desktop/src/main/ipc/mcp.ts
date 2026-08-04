import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface McpServerInput { name: string; transport: 'stdio' | 'sse' | 'http'; command?: string; args?: string[]; configJson?: string }

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
        .run(id, input.name, input.transport, JSON.stringify({ command: input.command, args: input.args, config: input.configJson }), new Date().toISOString());
      return this.list().find(s => s.id === id)!;
    },
    remove(id: string) { db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id); }
  };
}
