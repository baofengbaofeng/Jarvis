import { describe, it, expect } from 'vitest';
import type { ChatRequest, ProviderAdapter } from '@jarvis/core';
import { streamAdapter } from './office';

const req: ChatRequest = {
  provider: { id: 'p1', name: 'P', type: 'openai-compatible', baseUrl: 'https://x.com', apiKeyRef: 'ref', createdAt: '', updatedAt: '' },
  modelId: 'm1',
  messages: [],
  stream: true
};

describe('streamAdapter', () => {
  it('yields deltas and completes on done', async () => {
    const adapter: ProviderAdapter = {
      type: 'openai-compatible',
      async chat(_req, ctx) {
        ctx.onChunk({ kind: 'delta', delta: 'ab' });
        ctx.onChunk({ kind: 'done' });
      }
    };
    const gen = streamAdapter(req, 'key', { createAdapter: () => adapter });
    const out: string[] = [];
    for await (const c of gen) out.push(c.deltaText ?? '');
    expect(out.join('')).toBe('ab');
  });

  it('aborts the adapter when the consumer closes the generator early', async () => {
    let signal: AbortSignal | undefined;
    const adapter: ProviderAdapter = {
      type: 'openai-compatible',
      async chat(_req, ctx) {
        signal = ctx.signal;
        // Yield one delta then keep the stream open so the generator suspends at
        // a yield point — the only place a consumer break/return can interrupt it
        // (an internal-await suspension would not process return() until it
        // resolves). The abort fires from the generator's finally on close.
        ctx.onChunk({ kind: 'delta', delta: 'a' });
        await new Promise<void>((_, reject) => {
          ctx.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }
    };
    const gen = streamAdapter(req, 'key', { createAdapter: () => adapter });
    const first = await gen.next(); // consume the first delta
    expect(first.value?.deltaText).toBe('a');
    await gen.return(undefined); // consumer closes -> finally -> controller.abort()
    expect(signal?.aborted).toBe(true);
  });

  it('throws the adapter error to the consumer', async () => {
    const adapter: ProviderAdapter = {
      type: 'openai-compatible',
      async chat(_req, ctx) {
        ctx.onChunk({ kind: 'error', error: 'boom' });
      }
    };
    const gen = streamAdapter(req, 'key', { createAdapter: () => adapter });
    await expect(async () => {
      for await (const _c of gen) { /* drain */ }
    }).rejects.toThrow('boom');
  });
});
