import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { PassThrough } from 'node:stream';
import { ToolRegistry } from '@jarvis/core';
import { applyMigrations } from '../db/migrations';
import { assertMcpCommand, createMcpStore, testMcpServer, testMcpServerById, registerAgentMcpTools, closeAllMcpClients } from './mcp';

describe('mcp store', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  it('creates stdio server', () => {
    const store = createMcpStore(db);
    const s = store.create({ name: 'fs', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] });
    expect(s.transport).toBe('stdio');
    expect(store.list().length).toBe(1);
  });

  it('persists per-agent binding into config_json.agentIds', () => {
    const store = createMcpStore(db);
    store.create({ name: 'fs', transport: 'stdio', command: 'npx', args: [], agentIds: ['a1', 'a2'] });
    const listed = store.list();
    expect(listed[0].config.agentIds).toEqual(['a1', 'a2']);
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

  it('rejects non-stdio transport', async () => {
    const r = await testMcpServer({ name: 's', transport: 'sse', command: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('not supported');
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
    db.prepare('INSERT INTO mcp_servers (id, name, transport, config_json, created_at) VALUES (?,?,?,?,?)')
      .run('srv1', 'fs', 'stdio', JSON.stringify({ command: 'npx', args: [], agentIds: ['a1'] }), new Date().toISOString());
    const registry = new ToolRegistry();
    let spawns = 0;
    const deps = { spawnImpl: () => { spawns++; return new FakeProc() as unknown as import('node:child_process').ChildProcess; } };
    await registerAgentMcpTools(db, registry, 'a1', deps);
    await registerAgentMcpTools(db, registry, 'a1', deps);
    expect(spawns).toBe(1);
    expect(registry.has('mcp:fs:read')).toBe(true);
  });

  it('does not register a server bound to a different agent', async () => {
    db.prepare('INSERT INTO mcp_servers (id, name, transport, config_json, created_at) VALUES (?,?,?,?,?)')
      .run('srv1', 'fs', 'stdio', JSON.stringify({ command: 'npx', args: [], agentIds: ['a2'] }), new Date().toISOString());
    const registry = new ToolRegistry();
    await registerAgentMcpTools(db, registry, 'a1', { spawnImpl: () => new FakeProc() as unknown as import('node:child_process').ChildProcess });
    expect(registry.has('mcp:fs:read')).toBe(false);
  });
});
