import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import { MCP_FIELD_MAX } from '@jarvis/protocol';
import {
  createMcpClient,
  registerMcpTools,
  createMcpToolFilter,
  filterToolsForMcpBindings,
  type McpClient,
  type SpawnImpl,
  type ToolRegistry,
} from '@jarvis/core';

function asEnabled(value: unknown): boolean {
  return Number(value ?? 1) === 1;
}

export interface McpServerInput {
  name: string;
  transport: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  configJson?: string;
  // G6: agents this server is bound to; persisted into config_json.agentIds.
  agentIds?: string[];
}

/** Basename allowlist for MCP stdio launchers (DESK-12). Absolute paths also OK. */
const MCP_COMMAND_ALLOWLIST = new Set([
  'npx', 'npm', 'node', 'nodejs', 'uvx', 'uv', 'python', 'python3', 'bun', 'deno', 'docker',
]);

const MCP_UNSAFE = /[;&|`$<>\n\r]/;

export function assertMcpCommand(command: string, args: string[] = []): void {
  const cmd = command.trim();
  if (!cmd) throw new Error('MCP_COMMAND_REQUIRED');
  if (MCP_UNSAFE.test(cmd) || args.some(a => MCP_UNSAFE.test(a))) {
    throw new Error('MCP_COMMAND_UNSAFE');
  }
  const base = basename(cmd);
  if (!MCP_COMMAND_ALLOWLIST.has(base) && !isAbsolute(cmd)) {
    throw new Error('MCP_COMMAND_NOT_ALLOWED');
  }
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
        id: r.id as string,
        name: r.name as string,
        transport: r.transport as string,
        enabled: asEnabled(r.enabled),
        config: JSON.parse((r.config_json as string) ?? '{}'),
      }));
    },
    create(input: McpServerInput) {
      const name = (input.name ?? '').trim();
      if (!name) throw new Error('MCP_NAME_REQUIRED');
      if (name.length > MCP_FIELD_MAX.name) throw new Error('MCP_NAME_TOO_LONG');
      const command = (input.command ?? '').trim();
      const args = input.args ?? [];
      if (command.length > MCP_FIELD_MAX.command) throw new Error('MCP_COMMAND_TOO_LONG');
      const argsJoined = args.join(' ');
      if (argsJoined.length > MCP_FIELD_MAX.args) throw new Error('MCP_ARGS_TOO_LONG');
      if (input.transport === 'stdio') assertMcpCommand(command, args);
      const id = randomUUID();
      db.prepare('INSERT INTO mcp_servers (id, name, transport, config_json, created_at) VALUES (?,?,?,?,?)')
        .run(id, name, input.transport, JSON.stringify({ command, args, config: input.configJson, agentIds: input.agentIds ?? [] }), new Date().toISOString());
      return this.list().find(s => s.id === id)!;
    },
    setEnabled(id: string, enabled: boolean) {
      const cur = db.prepare('SELECT id FROM mcp_servers WHERE id = ?').get(id);
      if (!cur) throw new Error('MCP_SERVER_NOT_FOUND');
      db.prepare('UPDATE mcp_servers SET enabled=? WHERE id=?').run(enabled ? 1 : 0, id);
      if (!enabled) closeMcpClient(id);
      return this.list().find((s) => s.id === id)!;
    },
    remove(id: string) {
      db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
      // Stop the child process if this server was ever registered with the engine.
      closeMcpClient(id);
    }
  };
}

export type McpTestResult = { ok: boolean; tools: string[]; error?: string };

// G7: connectivity probe behind the settings page "Test" button. Spawns the
// server via createMcpClient, runs initialize + tools/list, and reports the
// discovered tool names (or an error) without persisting anything.
export async function testMcpServer(input: McpServerInput, deps: { spawnImpl?: SpawnImpl } = {}): Promise<McpTestResult> {
  if (input.transport !== 'stdio') return { ok: false, tools: [], error: `transport ${input.transport} not supported for test` };
  try {
    assertMcpCommand(input.command ?? '', input.args ?? []);
  } catch (e) {
    return { ok: false, tools: [], error: e instanceof Error ? e.message : String(e) };
  }
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

export async function testMcpServerById(
  db: Database.Database,
  serverId: string,
  deps: { spawnImpl?: SpawnImpl } = {},
): Promise<McpTestResult> {
  const row = db.prepare('SELECT name, transport, config_json FROM mcp_servers WHERE id = ?')
    .get(serverId) as { name: string; transport: McpServerInput['transport']; config_json: string } | undefined;
  if (!row) return { ok: false, tools: [], error: 'MCP_SERVER_NOT_FOUND' };
  const cfg = JSON.parse(row.config_json) as { command?: string; args?: string[] };
  return testMcpServer({ name: row.name, transport: row.transport, command: cfg.command, args: cfg.args }, deps);
}

export interface McpRegistrationDeps { spawnImpl?: SpawnImpl }

/** CORE-20: server names bound to this agent via config_json.agentIds. */
export function listBoundMcpServerNames(db: Database.Database, agentId: string): string[] {
  const rows = db.prepare('SELECT name, config_json, enabled FROM mcp_servers').all() as Array<{
    name: string;
    config_json: string;
    enabled?: number;
  }>;
  const names: string[] = [];
  for (const s of rows) {
    if (!asEnabled(s.enabled)) continue;
    const cfg = JSON.parse(s.config_json ?? '{}') as { agentIds?: string[] };
    if (cfg.agentIds?.includes(agentId)) names.push(s.name);
  }
  return names;
}

/**
 * CORE-20: build run-scoped MCP visibility from agent bindings (transport cache
 * stays shared; authorization is per-run).
 */
export function mcpVisibilityForAgent(db: Database.Database, agentId: string, allToolNames: string[]): {
  visibleTools: string[];
  toolFilter: (name: string) => boolean;
  boundServers: string[];
} {
  const boundServers = listBoundMcpServerNames(db, agentId);
  return {
    boundServers,
    visibleTools: filterToolsForMcpBindings(allToolNames, boundServers),
    toolFilter: createMcpToolFilter(boundServers),
  };
}

// G6: spawn each MCP server bound to the agent (config_json.agentIds) and
// register its tools into the engine registry under mcp:{server}:{tool}.
// stdio is the only transport createMcpClient supports today; sse/http are
// deferred. The client is cached per server id so subsequent task runs reuse
// the same child process instead of leaking one per run; a config change after
// first registration requires an app restart (documented in the task report).
// CORE-20: cache is transport-only — per-agent visibility is applied at run
// submit via mcpVisibilityForAgent / toolFilter, not by mutating the registry.
export async function registerAgentMcpTools(db: Database.Database, toolRegistry: ToolRegistry, agentId: string, deps: McpRegistrationDeps = {}): Promise<void> {
  const rows = db.prepare('SELECT id, name, transport, config_json, enabled FROM mcp_servers').all() as Array<{
    id: string;
    name: string;
    transport: string;
    config_json: string;
    enabled?: number;
  }>;
  for (const s of rows) {
    if (!asEnabled(s.enabled)) continue;
    const cfg = JSON.parse(s.config_json ?? '{}') as { command?: string; args?: string[]; agentIds?: string[] };
    if (s.transport !== 'stdio' || !cfg.command || !cfg.agentIds?.includes(agentId)) continue;
    if (mcpClientCache.has(s.id)) {
      // Already spawned — ensure tools are present (idempotent under CORE-07).
      const cached = mcpClientCache.get(s.id)!;
      await registerMcpTools(toolRegistry, cached.client, s.name);
      continue;
    }
    let client: McpClient | undefined;
    try {
      assertMcpCommand(cfg.command, cfg.args ?? []);
      client = createMcpClient(cfg.command, cfg.args ?? [], s.name, deps);
      await client.initialize();
      await registerMcpTools(toolRegistry, client, s.name);
      mcpClientCache.set(s.id, { client, serverName: s.name });
    } catch (e) {
      // M3 final review (J2): a client that failed to initialize/register was
      // never closed, leaking an orphaned child process (and the cache entry
      // wasn't set, so the next task would spawn yet another). Close it here.
      if (client) { try { client.close(); } catch { /* ignore */ } }
      console.error(`mcp: failed to register server ${s.name}`, e);
    }
  }
}
