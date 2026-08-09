import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { PassThrough } from 'node:stream';
import { ToolRegistry } from '@jarvis/core';
import { applyMigrations } from '../db/migrations';
import { assertMcpCommand, createMcpStore, testMcpServer, testMcpServerById, registerAgentMcpTools, closeAllMcpClients, mcpVisibilityForAgent, listBoundMcpServerNames } from './mcp';

describe('mcp store', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  it('creates stdio server', () => {
    const store = createMcpStore(db);
    const s = store.create({ name: 'fs', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] });
    expect(s.transport).toBe('stdio');
    expect(store.list().length).toBe(1);
  });

  it('persists the selected transport enum on list roundtrip', () => {
    const store = createMcpStore(db);
    store.create({ name: 'fs', transport: 'stdio', command: 'npx', args: [] });
    expect(store.list()[0]?.transport).toBe('stdio');
  });

  it('does not store agent binding on the server (Agent owns mcpServerIds)', () => {
    const store = createMcpStore(db);
    store.create({ name: 'fs', transport: 'stdio', command: 'npx', args: [], agentIds: ['a1', 'a2'] });
    const listed = store.list();
    expect(listed[0].config.agentIds ?? []).toEqual([]);
  });

  it('rejects empty or overlong name / command / args', () => {
    const store = createMcpStore(db);
    expect(() => store.create({ name: '  ', transport: 'stdio', command: 'npx', args: [] })).toThrow(
      'MCP_NAME_REQUIRED',
    );
    expect(() =>
      store.create({ name: 'n'.repeat(65), transport: 'stdio', command: 'npx', args: [] }),
    ).toThrow('MCP_NAME_TOO_LONG');
    expect(() =>
      store.create({ name: 'ok', transport: 'stdio', command: 'c'.repeat(513), args: [] }),
    ).toThrow('MCP_COMMAND_TOO_LONG');
    expect(() =>
      store.create({ name: 'ok', transport: 'stdio', command: 'npx', args: ['a'.repeat(2049)] }),
    ).toThrow('MCP_ARGS_TOO_LONG');
  });

  it('toggles enabled and defaults new servers to enabled', () => {
    const store = createMcpStore(db);
    const s = store.create({ name: 'fs', transport: 'stdio', command: 'npx', args: [] });
    expect(s.enabled).toBe(true);
    const off = store.setEnabled(s.id, false);
    expect(off.enabled).toBe(false);
    expect(store.list()[0]?.enabled).toBe(false);
  });

  it('updates cwd and persists on list', () => {
    const store = createMcpStore(db);
    const s = store.create({ name: 'fs', transport: 'stdio', command: 'npx', args: [] });
    const updated = store.update(s.id, { cwd: '/tmp/work' });
    expect(updated.config.cwd).toBe('/tmp/work');
    expect(store.list()[0]?.config.cwd).toBe('/tmp/work');
  });
});

describe('mcp.test', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  class FakeProc {
    stdout = new PassThrough();
    stdin = {
      write: (d: string) => {
        const m = JSON.parse(d);
        if (m.method === 'initialize') this.stdout.write(`{"jsonrpc":"2.0","id":${m.id},"result":{"capabilities":{}}}\n`);
        if (m.method === 'tools/list') this.stdout.write(`{"jsonrpc":"2.0","id":${m.id},"result":{"tools":[{"name":"read","description":"r","inputSchema":{}}]}}\n`);
      },
      end: () => {},
    };
    kill = () => {};
  }

  it('spawns a stdio server and reports the tool list', async () => {
    const r = await testMcpServer({ name: 'fs', transport: 'stdio', command: 'npx', args: ['-y', 'x'] }, { spawnImpl: () => new FakeProc() as unknown as import('node:child_process').ChildProcess });
    expect(r.ok).toBe(true);
    expect(r.tools).toEqual(['read']);
  });

  it('requires url for sse transport (remote supported)', async () => {
    const r = await testMcpServer({ name: 's', transport: 'sse', command: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('MCP_URL_REQUIRED');
  });

  it('loads the executable from the persisted server id', async () => {
    const store = createMcpStore(db);
    const saved = store.create({ name: 'fs', transport: 'stdio', command: 'npx', args: ['--stdio'] });
    const commands: string[] = [];
    const result = await testMcpServerById(db, saved.id, {
      spawnImpl: (cmd) => { commands.push(cmd); return new FakeProc() as never; },
    });
    expect(result.ok).toBe(true);
    expect(commands).toEqual(['npx']);
  });

  it('rejects unsafe or non-allowlisted commands (DESK-12)', async () => {
    expect(() => assertMcpCommand('bash', ['-c', 'id'])).toThrow('MCP_COMMAND_NOT_ALLOWED');
    expect(() => assertMcpCommand('npx; rm -rf /')).toThrow('MCP_COMMAND_UNSAFE');
    const store = createMcpStore(db);
    expect(() => store.create({ name: 'evil', transport: 'stdio', command: 'bash', args: ['-c', 'id'] })).toThrow('MCP_COMMAND_NOT_ALLOWED');
    const r = await testMcpServer({ name: 'evil', transport: 'stdio', command: 'curl', args: ['http://x'] });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('MCP_COMMAND_NOT_ALLOWED');
  });

  it('rejects an unknown id without spawning', async () => {
    const spawnImpl = vi.fn();
    await expect(testMcpServerById(db, 'missing', { spawnImpl })).resolves.toEqual({
      ok: false, tools: [], error: 'MCP_SERVER_NOT_FOUND',
    });
    expect(spawnImpl).not.toHaveBeenCalled();
  });
});

describe('registerAgentMcpTools client cache', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); closeAllMcpClients(); });
  afterEach(() => closeAllMcpClients());

  class FakeProc {
    stdout = new PassThrough();
    stdin = {
      write: (d: string) => {
        const m = JSON.parse(d);
        if (m.method === 'initialize') this.stdout.write(`{"jsonrpc":"2.0","id":${m.id},"result":{"capabilities":{}}}\n`);
        if (m.method === 'tools/list') this.stdout.write(`{"jsonrpc":"2.0","id":${m.id},"result":{"tools":[{"name":"read","description":"r","inputSchema":{}}]}}\n`);
      },
      end: () => {},
    };
    kill = () => {};
  }

  it('spawns + registers ONCE per server and reuses the cached client on later runs', async () => {
    db.prepare('INSERT INTO agents (id, name, slug, description, system_prompt, model_id, workspace_id, context_budget_tokens, plan_only, env_vars_json, cli_args_json, mcp_server_ids_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('a1', 'A', 'a', '', '', null, null, 128000, 0, '{}', '[]', JSON.stringify(['srv1']), new Date().toISOString(), new Date().toISOString());
    db.prepare('INSERT INTO mcp_servers (id, name, transport, config_json, created_at) VALUES (?,?,?,?,?)')
      .run('srv1', 'fs', 'stdio', JSON.stringify({ command: 'npx', args: [] }), new Date().toISOString());
    const registry = new ToolRegistry();
    let spawns = 0;
    const deps = { spawnImpl: () => { spawns++; return new FakeProc() as unknown as import('node:child_process').ChildProcess; } };
    await registerAgentMcpTools(db, registry, 'a1', deps);
    await registerAgentMcpTools(db, registry, 'a1', deps);
    expect(spawns).toBe(1);
    expect(registry.has('mcp:fs:read')).toBe(true);
  });

  it('does not register a server bound to a different agent', async () => {
    db.prepare('INSERT INTO agents (id, name, slug, description, system_prompt, model_id, workspace_id, context_budget_tokens, plan_only, env_vars_json, cli_args_json, mcp_server_ids_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('a2', 'A2', 'a2', '', '', null, null, 128000, 0, '{}', '[]', JSON.stringify(['srv1']), new Date().toISOString(), new Date().toISOString());
    db.prepare('INSERT INTO mcp_servers (id, name, transport, config_json, created_at) VALUES (?,?,?,?,?)')
      .run('srv1', 'fs', 'stdio', JSON.stringify({ command: 'npx', args: [] }), new Date().toISOString());
    const registry = new ToolRegistry();
    await registerAgentMcpTools(db, registry, 'a1', { spawnImpl: () => new FakeProc() as unknown as import('node:child_process').ChildProcess });
    expect(registry.has('mcp:fs:read')).toBe(false);
  });

  it('keeps MCP tools in the shared registry but filters visibility per agent (CORE-20)', async () => {
    db.prepare('INSERT INTO agents (id, name, slug, description, system_prompt, model_id, workspace_id, context_budget_tokens, plan_only, env_vars_json, cli_args_json, mcp_server_ids_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('a1', 'A', 'a', '', '', null, null, 128000, 0, '{}', '[]', JSON.stringify(['srv1']), new Date().toISOString(), new Date().toISOString());
    db.prepare('INSERT INTO mcp_servers (id, name, transport, config_json, created_at) VALUES (?,?,?,?,?)')
      .run('srv1', 'fs', 'stdio', JSON.stringify({ command: 'npx', args: [] }), new Date().toISOString());
    const registry = new ToolRegistry();
    registry.register({ name: 'read_file', description: '', parameters: {} }, async () => ({ ok: true, output: '' }));
    await registerAgentMcpTools(db, registry, 'a1', { spawnImpl: () => new FakeProc() as unknown as import('node:child_process').ChildProcess });
    expect(registry.has('mcp:fs:read')).toBe(true);
    expect(listBoundMcpServerNames(db, 'a1')).toEqual(['fs']);
    expect(listBoundMcpServerNames(db, 'a2')).toEqual([]);

    const all = registry.list().map(t => t.name);
    const forA1 = mcpVisibilityForAgent(db, 'a1', all);
    const forA2 = mcpVisibilityForAgent(db, 'a2', all);
    expect(forA1.visibleTools).toContain('mcp:fs:read');
    expect(forA1.visibleTools).toContain('read_file');
    expect(forA2.visibleTools).not.toContain('mcp:fs:read');
    expect(forA2.visibleTools).toContain('read_file');
    expect(forA2.toolFilter('mcp:fs:read')).toBe(false);
    expect(forA1.toolFilter('mcp:fs:read')).toBe(true);
  });
});
