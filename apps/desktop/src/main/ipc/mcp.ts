import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { MCP_FIELD_MAX } from '@jarvis/protocol';
import {
  registerMcpTools,
  createMcpToolFilter,
  filterToolsForMcpBindings,
  normalizeMcpServerConfig,
  assertMcpServerConfig,
  normalizeTransport,
  filterMcpToolNames,
  toClaudeMcpExport,
  fromClaudeMcpImport,
  normalizeAutoApprove,
  type ClaudeMcpDocument,
  type McpClient,
  type McpServerConfigJson,
  type SecretOrPlain,
  type SpawnImpl,
  type ToolRegistry,
  type RegisterMcpToolsOpts,
} from '@jarvis/core';
import { assertMcpCommand } from './mcpCommand';
import { openMcpClientForServer, type McpSecretStore } from './mcpOpen';

export { assertMcpCommand } from './mcpCommand';

function asEnabled(value: unknown): boolean {
  return Number(value ?? 1) === 1;
}

export interface McpServerInput {
  name: string;
  transport: 'stdio' | 'sse' | 'http' | 'streamable-http';
  command?: string;
  args?: string[];
  cwd?: string;
  description?: string;
  env?: Record<string, SecretOrPlain>;
  url?: string;
  headers?: Record<string, SecretOrPlain>;
  timeoutMs?: number;
  reconnectIntervalMs?: number;
  tlsVerify?: boolean;
  autoApprove?: string[];
  allowedTools?: string[] | null;
  blockedTools?: string[];
  configJson?: string;
  agentIds?: string[];
  /** Plaintext secrets to write under mcp.<id>.*; keys like env.TOKEN or headers.Authorization */
  secretValues?: Record<string, string>;
}

function parseLegacyConfigJson(configJson?: string): Record<string, unknown> {
  if (!configJson) return {};
  try {
    const parsed = JSON.parse(configJson) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function buildMcpConfigFromInput(input: McpServerInput): McpServerConfigJson {
  const legacy = parseLegacyConfigJson(input.configJson);
  return normalizeMcpServerConfig({
    ...legacy,
    command: input.command ?? legacy.command,
    args: input.args ?? legacy.args,
    // Binding lives on agents.mcp_server_ids_json — never store agentIds on servers.
    agentIds: [],
    cwd: input.cwd ?? legacy.cwd,
    description: input.description ?? legacy.description,
    env: input.env ?? legacy.env,
    url: input.url ?? legacy.url,
    headers: input.headers ?? legacy.headers,
    timeoutMs: input.timeoutMs ?? legacy.timeoutMs ?? legacy.timeout,
    reconnectIntervalMs: input.reconnectIntervalMs ?? legacy.reconnectIntervalMs,
    tlsVerify: input.tlsVerify ?? legacy.tlsVerify,
    autoApprove: input.autoApprove ?? legacy.autoApprove,
    allowedTools: input.allowedTools ?? legacy.allowedTools,
    blockedTools: input.blockedTools ?? legacy.blockedTools,
  });
}

async function applySecretValues(
  serverId: string,
  cfg: McpServerConfigJson,
  secretValues: Record<string, string> | undefined,
  secrets?: { set(key: string, value: string): Promise<void> },
): Promise<McpServerConfigJson> {
  if (!secretValues || !secrets) return cfg;
  const next: McpServerConfigJson = {
    ...cfg,
    env: { ...(cfg.env ?? {}) },
    headers: { ...(cfg.headers ?? {}) },
  };
  for (const [path, value] of Object.entries(secretValues)) {
    if (!value) continue;
    if (path.startsWith('env.')) {
      const key = path.slice(4);
      const ref = `mcp.${serverId}.env.${key}`;
      await secrets.set(ref, value);
      next.env![key] = { secretRef: ref };
    } else if (path.startsWith('headers.')) {
      const key = path.slice(8);
      const ref = `mcp.${serverId}.header.${key}`;
      await secrets.set(ref, value);
      next.headers![key] = { secretRef: ref };
    }
  }
  return next;
}

function collectSecretRefs(cfg: McpServerConfigJson): string[] {
  const refs: string[] = [];
  for (const map of [cfg.env, cfg.headers]) {
    if (!map) continue;
    for (const v of Object.values(map)) {
      if (v && typeof v === 'object' && 'secretRef' in v) refs.push(v.secretRef);
    }
  }
  return refs;
}

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

export function createMcpStore(
  db: Database.Database,
  deps: { secrets?: { set(key: string, value: string): Promise<void>; delete?(key: string): Promise<void> } } = {},
) {
  return {
    list() {
      return (db.prepare('SELECT * FROM mcp_servers ORDER BY created_at').all() as Record<string, unknown>[]).map(r => ({
        id: r.id as string,
        name: r.name as string,
        transport: r.transport as string,
        enabled: asEnabled(r.enabled),
        config: JSON.parse((r.config_json as string) ?? '{}') as McpServerConfigJson,
      }));
    },
    create(input: McpServerInput) {
      const name = (input.name ?? '').trim();
      if (!name) throw new Error('MCP_NAME_REQUIRED');
      if (name.length > MCP_FIELD_MAX.name) throw new Error('MCP_NAME_TOO_LONG');
      const transport = normalizeTransport(input.transport);
      let cfg = buildMcpConfigFromInput(input);
      assertMcpServerConfig(cfg, transport);
      if (transport === 'stdio') assertMcpCommand(cfg.command ?? '', cfg.args ?? []);
      const id = randomUUID();
      // Sync create path: secretValues applied only when secrets available via createAsync
      if (input.secretValues && Object.keys(input.secretValues).length && !deps.secrets) {
        throw new Error('MCP_SECRETS_REQUIRED');
      }
      db.prepare('INSERT INTO mcp_servers (id, name, transport, config_json, created_at) VALUES (?,?,?,?,?)')
        .run(id, name, transport, JSON.stringify(cfg), new Date().toISOString());
      return this.list().find(s => s.id === id)!;
    },
    async createAsync(input: McpServerInput) {
      const name = (input.name ?? '').trim();
      if (!name) throw new Error('MCP_NAME_REQUIRED');
      if (name.length > MCP_FIELD_MAX.name) throw new Error('MCP_NAME_TOO_LONG');
      const transport = normalizeTransport(input.transport);
      let cfg = buildMcpConfigFromInput(input);
      assertMcpServerConfig(cfg, transport);
      if (transport === 'stdio') assertMcpCommand(cfg.command ?? '', cfg.args ?? []);
      const id = randomUUID();
      cfg = await applySecretValues(id, cfg, input.secretValues, deps.secrets);
      db.prepare('INSERT INTO mcp_servers (id, name, transport, config_json, created_at) VALUES (?,?,?,?,?)')
        .run(id, name, transport, JSON.stringify(cfg), new Date().toISOString());
      return this.list().find(s => s.id === id)!;
    },
    update(id: string, patch: Partial<McpServerInput>) {
      const row = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      if (!row) throw new Error('MCP_SERVER_NOT_FOUND');
      const name = (patch.name ?? (row.name as string)).trim();
      if (!name) throw new Error('MCP_NAME_REQUIRED');
      if (name.length > MCP_FIELD_MAX.name) throw new Error('MCP_NAME_TOO_LONG');
      const transport = normalizeTransport(patch.transport ?? (row.transport as string));
      const existing = JSON.parse((row.config_json as string) ?? '{}') as McpServerConfigJson;
      const cfg = normalizeMcpServerConfig({
        ...existing,
        command: patch.command !== undefined ? patch.command : existing.command,
        args: patch.args !== undefined ? patch.args : existing.args,
        cwd: patch.cwd !== undefined ? patch.cwd : existing.cwd,
        description: patch.description !== undefined ? patch.description : existing.description,
        env: patch.env !== undefined ? patch.env : existing.env,
        url: patch.url !== undefined ? patch.url : existing.url,
        headers: patch.headers !== undefined ? patch.headers : existing.headers,
        timeoutMs: patch.timeoutMs !== undefined ? patch.timeoutMs : existing.timeoutMs,
        reconnectIntervalMs: patch.reconnectIntervalMs !== undefined ? patch.reconnectIntervalMs : existing.reconnectIntervalMs,
        tlsVerify: patch.tlsVerify !== undefined ? patch.tlsVerify : existing.tlsVerify,
        autoApprove: patch.autoApprove !== undefined ? patch.autoApprove : existing.autoApprove,
        allowedTools: patch.allowedTools !== undefined ? patch.allowedTools : existing.allowedTools,
        blockedTools: patch.blockedTools !== undefined ? patch.blockedTools : existing.blockedTools,
        agentIds: [],
      });
      assertMcpServerConfig(cfg, transport);
      if (transport === 'stdio') assertMcpCommand(cfg.command ?? '', cfg.args ?? []);
      db.prepare('UPDATE mcp_servers SET name=?, transport=?, config_json=? WHERE id=?')
        .run(name, transport, JSON.stringify(cfg), id);
      closeMcpClient(id);
      return this.list().find(s => s.id === id)!;
    },
    async updateAsync(id: string, patch: Partial<McpServerInput>) {
      const updated = this.update(id, patch);
      if (patch.secretValues && deps.secrets) {
        const cfg = await applySecretValues(id, updated.config, patch.secretValues, deps.secrets);
        db.prepare('UPDATE mcp_servers SET config_json=? WHERE id=?').run(JSON.stringify(cfg), id);
        closeMcpClient(id);
        return this.list().find(s => s.id === id)!;
      }
      return updated;
    },
    setEnabled(id: string, enabled: boolean) {
      const cur = db.prepare('SELECT id FROM mcp_servers WHERE id = ?').get(id);
      if (!cur) throw new Error('MCP_SERVER_NOT_FOUND');
      db.prepare('UPDATE mcp_servers SET enabled=? WHERE id=?').run(enabled ? 1 : 0, id);
      if (!enabled) closeMcpClient(id);
      return this.list().find((s) => s.id === id)!;
    },
    remove(id: string) {
      const row = db.prepare('SELECT config_json FROM mcp_servers WHERE id = ?').get(id) as { config_json: string } | undefined;
      if (row && deps.secrets?.delete) {
        const cfg = JSON.parse(row.config_json ?? '{}') as McpServerConfigJson;
        for (const ref of collectSecretRefs(cfg)) {
          void deps.secrets.delete(ref).catch(() => {});
        }
      }
      db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
      closeMcpClient(id);
    },
    exportDocument(globals: {
      autoStartMcp?: boolean;
      logLevel?: string;
      maxConcurrentTools?: number;
      globalEnv?: Record<string, SecretOrPlain>;
    } = {}): ClaudeMcpDocument {
      return toClaudeMcpExport(this.list(), globals);
    },
    importDocument(
      doc: unknown,
      strategy: 'skip' | 'overwrite' | 'merge' = 'skip',
    ): { imported: number; skipped: number } {
      const { servers } = fromClaudeMcpImport(doc);
      let imported = 0;
      let skipped = 0;
      const existingByName = new Map(this.list().map((s) => [s.name, s]));
      for (const s of servers) {
        const hit = existingByName.get(s.name);
        if (hit) {
          if (strategy === 'skip') {
            skipped++;
            continue;
          }
          if (strategy === 'overwrite' || strategy === 'merge') {
            this.update(hit.id, {
              name: s.name,
              transport: s.transport,
              command: s.config.command,
              args: s.config.args,
              cwd: s.config.cwd,
              description: s.config.description,
              env: s.config.env,
              url: s.config.url,
              headers: s.config.headers,
              timeoutMs: s.config.timeoutMs,
              reconnectIntervalMs: s.config.reconnectIntervalMs,
              tlsVerify: s.config.tlsVerify,
              autoApprove: s.config.autoApprove,
              allowedTools: s.config.allowedTools,
              blockedTools: s.config.blockedTools,
            });
            this.setEnabled(hit.id, s.enabled);
            imported++;
          }
          continue;
        }
        const row = this.create({
          name: s.name,
          transport: s.transport,
          command: s.config.command,
          args: s.config.args,
          cwd: s.config.cwd,
          description: s.config.description,
          env: s.config.env,
          url: s.config.url,
          headers: s.config.headers,
          timeoutMs: s.config.timeoutMs,
          reconnectIntervalMs: s.config.reconnectIntervalMs,
          tlsVerify: s.config.tlsVerify,
          autoApprove: s.config.autoApprove,
          allowedTools: s.config.allowedTools,
          blockedTools: s.config.blockedTools,
        });
        if (!s.enabled) this.setEnabled(row.id, false);
        imported++;
      }
      return { imported, skipped };
    },
  };
}

export type McpTestResult = { ok: boolean; tools: string[]; error?: string };

export async function testMcpServer(
  input: McpServerInput,
  deps: {
    spawnImpl?: SpawnImpl;
    fetchImpl?: typeof fetch;
    secrets?: McpSecretStore;
    assertAllowedUrl?: (url: string) => Promise<void>;
  } = {},
): Promise<McpTestResult> {
  try {
    const transport = normalizeTransport(input.transport);
    const cfg = buildMcpConfigFromInput(input);
    assertMcpServerConfig(cfg, transport);
    const client = await openMcpClientForServer({ name: input.name, transport, config: cfg }, deps);
    try {
      await client.initialize();
      const tools = await client.listTools();
      const names = filterMcpToolNames(tools.map(t => t.name), {
        allowedTools: cfg.allowedTools,
        blockedTools: cfg.blockedTools,
      });
      return { ok: true, tools: names };
    } finally {
      client.close();
    }
  } catch (e) {
    return { ok: false, tools: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export async function testMcpServerById(
  db: Database.Database,
  serverId: string,
  deps: {
    spawnImpl?: SpawnImpl;
    fetchImpl?: typeof fetch;
    secrets?: McpSecretStore;
    assertAllowedUrl?: (url: string) => Promise<void>;
    globalEnv?: Record<string, SecretOrPlain>;
  } = {},
): Promise<McpTestResult> {
  const row = db.prepare('SELECT name, transport, config_json FROM mcp_servers WHERE id = ?')
    .get(serverId) as { name: string; transport: string; config_json: string } | undefined;
  if (!row) return { ok: false, tools: [], error: 'MCP_SERVER_NOT_FOUND' };
  const cfg = normalizeMcpServerConfig(JSON.parse(row.config_json));
  return testMcpServer({
    name: row.name,
    transport: row.transport as McpServerInput['transport'],
    command: cfg.command,
    args: cfg.args,
    cwd: cfg.cwd,
    env: cfg.env,
    url: cfg.url,
    headers: cfg.headers,
    timeoutMs: cfg.timeoutMs,
    allowedTools: cfg.allowedTools,
    blockedTools: cfg.blockedTools,
  }, deps);
}

export interface McpRegistrationDeps {
  spawnImpl?: SpawnImpl;
  secrets?: McpSecretStore;
  globalEnv?: Record<string, SecretOrPlain>;
  fetchImpl?: typeof fetch;
  assertAllowedUrl?: (url: string) => Promise<void>;
  registerOpts?: RegisterMcpToolsOpts;
}

/** Server UUIDs the agent opted into (agents.mcp_server_ids_json). */
export function agentBoundMcpServerIds(db: Database.Database, agentId: string): Set<string> {
  const row = db.prepare('SELECT mcp_server_ids_json FROM agents WHERE id = ?').get(agentId) as
    | { mcp_server_ids_json?: string }
    | undefined;
  if (!row) return new Set();
  try {
    const parsed = JSON.parse(row.mcp_server_ids_json ?? '[]') as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Collect normalized autoApprove tool ids for servers bound to an agent. */
export function listAutoApproveToolIds(db: Database.Database, agentId: string): string[] {
  const bound = agentBoundMcpServerIds(db, agentId);
  if (bound.size === 0) return [];
  const rows = db.prepare('SELECT id, name, config_json, enabled FROM mcp_servers').all() as Array<{
    id: string;
    name: string;
    config_json: string;
    enabled?: number;
  }>;
  const out: string[] = [];
  for (const s of rows) {
    if (!asEnabled(s.enabled) || !bound.has(s.id)) continue;
    const cfg = normalizeMcpServerConfig(JSON.parse(s.config_json ?? '{}'));
    out.push(...normalizeAutoApprove(s.name, cfg.autoApprove));
  }
  return out;
}

export function listBoundMcpServerNames(db: Database.Database, agentId: string): string[] {
  const bound = agentBoundMcpServerIds(db, agentId);
  if (bound.size === 0) return [];
  const rows = db.prepare('SELECT id, name, enabled FROM mcp_servers').all() as Array<{
    id: string;
    name: string;
    enabled?: number;
  }>;
  const names: string[] = [];
  for (const s of rows) {
    if (asEnabled(s.enabled) && bound.has(s.id)) names.push(s.name);
  }
  return names;
}

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

export async function registerAgentMcpTools(
  db: Database.Database,
  toolRegistry: ToolRegistry,
  agentId: string,
  deps: McpRegistrationDeps = {},
): Promise<void> {
  const rows = db.prepare('SELECT id, name, transport, config_json, enabled FROM mcp_servers').all() as Array<{
    id: string;
    name: string;
    transport: string;
    config_json: string;
    enabled?: number;
  }>;
  const bound = agentBoundMcpServerIds(db, agentId);
  for (const s of rows) {
    if (!asEnabled(s.enabled) || !bound.has(s.id)) continue;
    const cfg = normalizeMcpServerConfig(JSON.parse(s.config_json ?? '{}'));
    if (mcpClientCache.has(s.id)) {
      const cached = mcpClientCache.get(s.id)!;
      await registerMcpTools(toolRegistry, cached.client, s.name, {
        ...deps.registerOpts,
        allowedTools: cfg.allowedTools,
        blockedTools: cfg.blockedTools,
      });
      continue;
    }
    let client: McpClient | undefined;
    try {
      client = await openMcpClientForServer({ name: s.name, transport: s.transport, config: cfg }, deps);
      await client.initialize();
      await registerMcpTools(toolRegistry, client, s.name, {
        ...deps.registerOpts,
        allowedTools: cfg.allowedTools,
        blockedTools: cfg.blockedTools,
      });
      mcpClientCache.set(s.id, { client, serverName: s.name });
    } catch (e) {
      if (client) { try { client.close(); } catch { /* ignore */ } }
      console.error(`mcp: failed to register server ${s.name}`, e);
    }
  }
}

/** Warm-connect enabled servers (mcp.auto_start). Failures are logged, non-fatal. */
export async function warmStartMcpServers(
  db: Database.Database,
  deps: McpRegistrationDeps = {},
): Promise<void> {
  const rows = db.prepare('SELECT id, name, transport, config_json, enabled FROM mcp_servers').all() as Array<{
    id: string;
    name: string;
    transport: string;
    config_json: string;
    enabled?: number;
  }>;
  for (const s of rows) {
    if (!asEnabled(s.enabled) || mcpClientCache.has(s.id)) continue;
    const cfg = normalizeMcpServerConfig(JSON.parse(s.config_json ?? '{}'));
    let client: McpClient | undefined;
    try {
      client = await openMcpClientForServer({ name: s.name, transport: s.transport, config: cfg }, deps);
      await client.initialize();
      mcpClientCache.set(s.id, { client, serverName: s.name });
    } catch (e) {
      if (client) { try { client.close(); } catch { /* ignore */ } }
      console.error(`mcp: auto_start failed for ${s.name}`, e);
    }
  }
}
