import { describe, expect, it, vi } from 'vitest';
import { createStreamableHttpTransport } from './httpTransport';

describe('createStreamableHttpTransport', () => {
  it('POSTs JSON-RPC and emits JSON response', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).method).toBe('initialize');
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' },
      });
    });
    const transport = createStreamableHttpTransport({ url: 'https://mcp.example/mcp', fetchImpl });
    const seen: unknown[] = [];
    transport.onMessage((m) => seen.push(m));
    transport.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual([{ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } }]);

    fetchImpl.mockImplementationOnce(async (_url, init) => {
      const h = init?.headers as Record<string, string>;
      expect(h['Mcp-Session-Id']).toBe('sess-1');
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    transport.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    await new Promise((r) => setTimeout(r, 20));
    expect(seen[1]).toEqual({ jsonrpc: '2.0', id: 2, result: { tools: [] } });
    transport.close();
  });

  it('accepts SSE-scoped JSON-RPC responses', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      'event: message\ndata: {"jsonrpc":"2.0","id":3,"result":{"ok":1}}\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));
    const transport = createStreamableHttpTransport({ url: 'https://mcp.example/mcp', fetchImpl });
    const seen: unknown[] = [];
    transport.onMessage((m) => seen.push(m));
    transport.send({ jsonrpc: '2.0', id: 3, method: 'ping', params: {} });
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual([{ jsonrpc: '2.0', id: 3, result: { ok: 1 } }]);
    transport.close();
  });
});
