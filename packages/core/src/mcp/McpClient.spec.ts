import { describe, it, expect } from 'vitest';
import { createMcpClient } from './McpClient';
import { PassThrough } from 'node:stream';

// Test double for a child process: the stdio transport reads responses from
// child.stdout, so the fake exposes a PassThrough stdout and echoes JSON-RPC
// responses there from stdin.write.
class FakeProc {
  stdout = new PassThrough();
  stdin = {
    write: (d: string) => {
      const m = JSON.parse(d);
      const id = m.id as number;
      if (m.method === 'initialize') this.stdout.write(`{"jsonrpc":"2.0","id":${id},"result":{"capabilities":{}}}\n`);
      if (m.method === 'tools/list') this.stdout.write(`{"jsonrpc":"2.0","id":${id},"result":{"tools":[{"name":"read","description":"r","inputSchema":{}}]}}\n`);
      if (m.method === 'tools/call') this.stdout.write(`{"jsonrpc":"2.0","id":${id},"result":{"content":[{"type":"text","text":"ok"}]}}\n`);
    },
    end: () => {},
  };
  kill = () => {};
}

describe('McpClient', () => {
  it('lists and calls tools over stdio', async () => {
    const client = createMcpClient('', [], 'fs', { spawnImpl: () => new FakeProc() as unknown as import('node:child_process').ChildProcess });
    await client.initialize();
    const tools = await client.listTools();
    expect(tools[0].name).toBe('read');
    const r = await client.callTool('read', { path: '/x' });
    expect(r).toContain('ok');
    client.close();
  });

  it('times out a hung request (CORE-08)', async () => {
    class SilentProc {
      stdout = new PassThrough();
      stdin = { write: () => {}, end: () => {} };
      kill = () => {};
    }
    const client = createMcpClient('', [], 'fs', {
      spawnImpl: () => new SilentProc() as unknown as import('node:child_process').ChildProcess,
      requestTimeoutMs: 30,
    });
    await expect(client.initialize()).rejects.toThrow(/timeout/i);
    client.close();
  });

  it('rejects pending requests on close (CORE-08)', async () => {
    class SilentProc {
      stdout = new PassThrough();
      stdin = { write: () => {}, end: () => {} };
      kill = () => {};
    }
    const client = createMcpClient('', [], 'fs', {
      spawnImpl: () => new SilentProc() as unknown as import('node:child_process').ChildProcess,
      requestTimeoutMs: 60_000,
    });
    const pending = client.initialize();
    // Let the request be registered, then close before any response.
    await new Promise(r => setTimeout(r, 0));
    client.close();
    await expect(pending).rejects.toThrow(/closed|abort|cancel/i);
  });
});
