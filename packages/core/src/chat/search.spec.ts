import { describe, it, expect } from 'vitest';
import { searchWeb } from './search';

describe('searchWeb', () => {
  it('returns cited results from custom endpoint', async () => {
    const results = await searchWeb('jarvis ai', {
      engine: 'custom', endpoint: 'https://search.example.com', apiKey: 'sk-x'
    }, { fetchImpl: async () => ({
      ok: true, json: async () => ({ results: [{ title: 'JARVIS', url: 'https://jarvis.ai', snippet: 'desc' }] })
    }) as Response });
    expect(results[0].title).toBe('JARVIS');
  });

  it('throws retryable error when endpoint down', async () => {
    await expect(searchWeb('x', { engine: 'custom', endpoint: 'https://down.example.com', apiKey: 'k' }, {
      fetchImpl: async () => ({ ok: false, status: 503, text: async () => '' }) as Response
    })).rejects.toThrow('search');
  });
});
