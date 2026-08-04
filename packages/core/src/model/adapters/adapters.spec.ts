import { describe, it, expect } from 'vitest';
import { createAdapter } from './index';
import type { ChatRequest } from '../types';

function mockFetch(lines: string[]) {
  const body = lines.join('\n') + '\n';
  return async () => ({ ok: true, status: 200, body: new ReadableStream({
    start(c) {
      const enc = new TextEncoder();
      c.enqueue(enc.encode(body));
      c.close();
    }
  }) }) as unknown as Response;
}

describe('openai adapter', () => {
  it('streams deltas and done', async () => {
    const adapter = createAdapter('openai-compatible', { fetchImpl: mockFetch([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}',
      'data: {"choices":[{"delta":{"content":"lo"}}]}',
      'data: [DONE]'
    ]) });
    const chunks: string[] = [];
    const req: ChatRequest = {
      provider: { id: 'p1', name: 'p', type: 'openai-compatible', baseUrl: 'https://api.example.com', apiKeyRef: 'k', createdAt: '', updatedAt: '' },
      modelId: 'my-model', messages: [{ role: 'user', content: 'hi' }], stream: true
    };
    await adapter.chat(req, { apiKey: 'sk-test', onChunk: (c) => { if (c.kind === 'delta') chunks.push(c.delta); } });
    expect(chunks.join('')).toBe('Hello');
  });
});

describe('anthropic adapter', () => {
  it('streams text deltas', async () => {
    const adapter = createAdapter('anthropic-compatible', { fetchImpl: mockFetch([
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}'
    ]) });
    const chunks: string[] = [];
    const req: ChatRequest = {
      provider: { id: 'p1', name: 'p', type: 'anthropic-compatible', baseUrl: 'https://api.example.com', apiKeyRef: 'k', createdAt: '', updatedAt: '' },
      modelId: 'my-model', messages: [{ role: 'user', content: 'hi' }], stream: true
    };
    await adapter.chat(req, { apiKey: 'sk-ant-test', onChunk: (c) => { if (c.kind === 'delta') chunks.push(c.delta); } });
    expect(chunks.join('')).toBe('Hi');
  });
});
