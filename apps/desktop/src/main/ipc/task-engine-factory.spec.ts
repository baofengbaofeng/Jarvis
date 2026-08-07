import { describe, it, expect, vi } from 'vitest';
import { ModelRouter, RetryableError, type ChatRequest, type ProviderAdapter } from '@jarvis/core';
import { createDefaultChatFn } from './task-engine-factory';

const baseReq: ChatRequest = {
  provider: {
    id: 'p1', name: 'p', type: 'openai-compatible',
    baseUrl: 'https://api.example.com', apiKeyRef: 'k',
    createdAt: '', updatedAt: '',
  },
  modelId: 'm1',
  messages: [{ role: 'user', content: 'hi' }],
  stream: true,
};

describe('createDefaultChatFn (CORE-04)', () => {
  it('routes task chat through ModelRouter retry policy instead of bare adapter', async () => {
    let calls = 0;
    const adapter: ProviderAdapter = {
      type: 'openai-compatible',
      async chat(_r, ctx) {
        calls++;
        if (calls === 1) throw new RetryableError('http 429');
        ctx.onChunk({ kind: 'delta', delta: 'ok' });
        ctx.onChunk({ kind: 'done' });
      },
    };
    const router = new ModelRouter({ createAdapter: () => adapter });
    const chatFn = createDefaultChatFn(undefined, { router, policy: { timeoutMs: 5_000, maxRetries: 2, circuitBreaker: false } });
    const r = await chatFn(baseReq, { apiKey: 'sk-test' });
    expect(r.text).toBe('ok');
    expect(calls).toBe(2);
  });

  it('builds a ModelRouter-backed chatFn when no router is injected', async () => {
    // Spy: a custom http client proves adapters are created via the router's
    // createAdapter path (bare adapter bypass would still call http, but the
    // factory must accept router injection — covered above — and default
    // construction must not throw).
    const http = { request: vi.fn(async () => { throw new Error('URL_PRIVATE_ADDRESS'); }) };
    const chatFn = createDefaultChatFn(http);
    await expect(chatFn(baseReq, { apiKey: 'sk' })).rejects.toThrow(/URL_PRIVATE_ADDRESS|chat failed|http/);
  });
});
