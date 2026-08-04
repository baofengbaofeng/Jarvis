import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { PassThrough } from 'node:stream';
import { applyMigrations } from '../db/migrations';
import { createMcpStore, testMcpServer } from './mcp';

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
});
