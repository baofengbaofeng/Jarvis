import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ModelRouter, RetryableError, TimeoutError } from './router';
import type { ChatRequest, ProviderAdapter } from './types';
import type { Provider } from '@jarvis/protocol';

const provider: Provider = { id: 'p1', name: 'p', type: 'openai-compatible', baseUrl: 'https://x.com', apiKeyRef: 'k', createdAt: '', updatedAt: '' };
const req: ChatRequest = { provider, modelId: 'primary', messages: [{ role: 'user', content: 'hi' }], stream: false };

describe('ModelRouter', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

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
    const p = router.chat(req, { apiKeyResolver: async () => 'sk', policy: { timeoutMs: 5000, maxRetries: 2, circuitBreaker: false } });
    await vi.runAllTimersAsync();
    const r = await p;
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
    const p = router.chat(req, {
      apiKeyResolver: async () => 'sk',
      policy: { timeoutMs: 5000, maxRetries: 0, circuitBreaker: false },
      fallbackModelIds: ['backup-1']
    });
    await expect(p).rejects.toThrow();
    expect(usedModels).toContain('primary');
    expect(usedModels).toContain('backup-1');
  });

  it('uses idle timeout that resets on chunks, not wall-clock (CORE-17)', async () => {
    const adapter: ProviderAdapter = {
      type: 'openai-compatible',
      async chat(_r, ctx) {
        // Emit a delta every 40ms for 150ms total — wall clock would exceed
        // timeoutMs=100, but idle gaps stay under 100ms so it must succeed.
        for (let i = 0; i < 4; i++) {
          await new Promise((r) => setTimeout(r, 40));
          ctx.onChunk({ kind: 'delta', delta: `${i}` });
        }
        ctx.onChunk({ kind: 'done' });
      }
    };
    const router = new ModelRouter({ createAdapter: () => adapter });
    const p = router.chat(req, {
      apiKeyResolver: async () => 'sk',
      policy: { timeoutMs: 100, maxRetries: 0, circuitBreaker: false },
    });
    await vi.advanceTimersByTimeAsync(200);
    const r = await p;
    expect(r.text).toBe('0123');
  });

  it('fires TimeoutError when idle between chunks exceeds timeoutMs (CORE-17)', async () => {
    const adapter: ProviderAdapter = {
      type: 'openai-compatible',
      async chat(_r, ctx) {
        ctx.onChunk({ kind: 'delta', delta: 'a' });
        await new Promise((r) => setTimeout(r, 200));
        ctx.onChunk({ kind: 'delta', delta: 'b' });
        ctx.onChunk({ kind: 'done' });
      }
    };
    const router = new ModelRouter({ createAdapter: () => adapter });
    const p = router.chat(req, {
      apiKeyResolver: async () => 'sk',
      policy: { timeoutMs: 50, maxRetries: 0, circuitBreaker: false },
    });
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
  });

  it('does not emit duplicate deltas when retrying after a partial stream (CORE-17)', async () => {
    let calls = 0;
    const deltas: string[] = [];
    const adapter: ProviderAdapter = {
      type: 'openai-compatible',
      async chat(_r, ctx) {
        calls++;
        if (calls === 1) {
          ctx.onChunk({ kind: 'delta', delta: 'partial-' });
          throw new RetryableError('http 503');
        }
        ctx.onChunk({ kind: 'delta', delta: 'full' });
        ctx.onChunk({ kind: 'done' });
      }
    };
    const router = new ModelRouter({ createAdapter: () => adapter });
    const p = router.chat(req, {
      apiKeyResolver: async () => 'sk',
      policy: { timeoutMs: 5000, maxRetries: 2, circuitBreaker: false },
      onChunk: (c) => { if (c.kind === 'delta') deltas.push(c.delta); },
    });
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.text).toBe('full');
    expect(deltas).toEqual(['full']);
    expect(calls).toBe(2);
  });

  it('applies exponential backoff between retries (CORE-17)', async () => {
    let calls = 0;
    const adapter: ProviderAdapter = {
      type: 'openai-compatible',
      async chat(_r, ctx) {
        calls++;
        if (calls < 3) throw new RetryableError('http 429');
        ctx.onChunk({ kind: 'delta', delta: 'ok' });
        ctx.onChunk({ kind: 'done' });
      }
    };
    const router = new ModelRouter({
      createAdapter: () => adapter,
      // Deterministic backoff for the test (no jitter).
      backoffMs: (attempt) => 100 * 2 ** attempt,
    });
    const p = router.chat(req, {
      apiKeyResolver: async () => 'sk',
      policy: { timeoutMs: 5000, maxRetries: 3, circuitBreaker: false },
    });
    // Before any backoff flush, still on first failure path.
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1); // 100ms → second attempt
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(200); // 200ms → third attempt
    const r = await p;
    expect(r.text).toBe('ok');
    expect(calls).toBe(3);
  });

  it('opens the circuit, then allows a half-open probe after cooldown (CORE-17)', async () => {
    let calls = 0;
    const adapter: ProviderAdapter = {
      type: 'openai-compatible',
      async chat() {
        calls++;
        throw new RetryableError('http 500');
      }
    };
    const router = new ModelRouter({
      createAdapter: () => adapter,
      backoffMs: () => 0,
      circuitCooldownMs: 1000,
      circuitFailureThreshold: 2,
    });
    const policy = { timeoutMs: 5000, maxRetries: 0, circuitBreaker: true };

    await expect(router.chat(req, { apiKeyResolver: async () => 'sk', policy })).rejects.toThrow(/http 500|circuit/i);
    await expect(router.chat(req, { apiKeyResolver: async () => 'sk', policy })).rejects.toThrow(/http 500|circuit/i);
    // Threshold reached → next call should fail fast while open.
    const openCalls = calls;
    await expect(router.chat(req, { apiKeyResolver: async () => 'sk', policy })).rejects.toThrow(/circuit open/i);
    expect(calls).toBe(openCalls);

    // After cooldown → half-open allows one probe (which fails → open again).
    await vi.advanceTimersByTimeAsync(1000);
    await expect(router.chat(req, { apiKeyResolver: async () => 'sk', policy })).rejects.toThrow(/http 500|circuit/i);
    expect(calls).toBe(openCalls + 1);
  });

  it('closes the circuit after a successful half-open probe (CORE-17)', async () => {
    let calls = 0;
    const adapter: ProviderAdapter = {
      type: 'openai-compatible',
      async chat(_r, ctx) {
        calls++;
        if (calls <= 2) throw new RetryableError('http 500');
        ctx.onChunk({ kind: 'delta', delta: 'recovered' });
        ctx.onChunk({ kind: 'done' });
      }
    };
    const router = new ModelRouter({
      createAdapter: () => adapter,
      backoffMs: () => 0,
      circuitCooldownMs: 500,
      circuitFailureThreshold: 2,
    });
    const policy = { timeoutMs: 5000, maxRetries: 0, circuitBreaker: true };
    await expect(router.chat(req, { apiKeyResolver: async () => 'sk', policy })).rejects.toThrow();
    await expect(router.chat(req, { apiKeyResolver: async () => 'sk', policy })).rejects.toThrow();
    await expect(router.chat(req, { apiKeyResolver: async () => 'sk', policy })).rejects.toThrow(/circuit open/i);

    await vi.advanceTimersByTimeAsync(500);
    const p = router.chat(req, { apiKeyResolver: async () => 'sk', policy });
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.text).toBe('recovered');

    // Circuit closed — subsequent calls work without waiting for cooldown.
    const p2 = router.chat(req, { apiKeyResolver: async () => 'sk', policy });
    await vi.runAllTimersAsync();
    expect((await p2).text).toBe('recovered');
  });
});
