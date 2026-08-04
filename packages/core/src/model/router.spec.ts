import { describe, it, expect } from 'vitest';
import { ModelRouter, RetryableError } from './router';
import type { ChatRequest, ProviderAdapter } from './types';
import type { Provider } from '@jarvis/protocol';

const provider: Provider = { id: 'p1', name: 'p', type: 'openai-compatible', baseUrl: 'https://x.com', apiKeyRef: 'k', createdAt: '', updatedAt: '' };
const req: ChatRequest = { provider, modelId: 'primary', messages: [{ role: 'user', content: 'hi' }], stream: false };

describe('ModelRouter', () => {
  it('retries on retryable error then succeeds', async () => {
    let calls = 0;
    const adapter: ProviderAdapter = {
      type: 'openai-compatible',
      async chat(_r, ctx) {
        calls++;
        if (calls === 1) throw new RetryableError('http 429');
        ctx.onChunk({ kind: 'delta', delta: 'ok' });
        ctx.onChunk({ kind: 'done' });
      }
    };
    const router = new ModelRouter({ createAdapter: () => adapter });
    const r = await router.chat(req, { apiKeyResolver: async () => 'sk', policy: { timeoutMs: 5000, maxRetries: 2, circuitBreaker: false } });
    expect(r.text).toBe('ok');
    expect(calls).toBe(2);
  });

  it('falls back to fallback model on persistent failure', async () => {
    const usedModels: string[] = [];
    const adapter: ProviderAdapter = {
      type: 'openai-compatible',
      async chat(r) { usedModels.push(r.modelId); throw new RetryableError('http 500'); }
    };
    const router = new ModelRouter({ createAdapter: () => adapter });
    await expect(router.chat(req, {
      apiKeyResolver: async () => 'sk',
      policy: { timeoutMs: 5000, maxRetries: 0, circuitBreaker: false },
      fallbackModelIds: ['backup-1']
    })).rejects.toThrow();
    expect(usedModels).toContain('primary');
    expect(usedModels).toContain('backup-1');
  });
});
