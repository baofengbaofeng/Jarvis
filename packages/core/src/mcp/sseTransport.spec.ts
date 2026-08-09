import { describe, expect, it, vi } from 'vitest';
import { createSseTransport } from './sseTransport';

function sseResponse(blocks: string[]): Response {
  const text = blocks.join('');
  return new Response(text, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('createSseTransport', () => {
  it('discovers endpoint then POSTs and emits SSE message', async () => {
    const posts: Array<{ url: string; body: string }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return sseResponse([
          'event: endpoint\ndata: /messages\n\n',
          'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n',
        ]);
      }
      posts.push({ url: String(url), body: String(init?.body ?? '') });
      return new Response(null, { status: 202 });
    });

    const transport = createSseTransport({ url: 'https://mcp.example/sse', fetchImpl });
    const seen: unknown[] = [];
    transport.onMessage((m) => seen.push(m));

    await new Promise((r) => setTimeout(r, 20));
    transport.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    await new Promise((r) => setTimeout(r, 30));

    expect(posts[0]?.url).toBe('https://mcp.example/messages');
    expect(JSON.parse(posts[0]!.body).method).toBe('initialize');
    expect(seen).toContainEqual({ jsonrpc: '2.0', id: 1, result: { ok: true } });
    transport.close();
  });
});
