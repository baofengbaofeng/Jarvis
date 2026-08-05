import { describe, it, expect } from 'vitest';
import { buildSearchRequest, parseSearchResults } from './searchProvider';

describe('search provider', () => {
  it('builds provider-specific requests', () => {
    const serper = buildSearchRequest({ type: 'serper', apiKey: 'k', enabled: true }, 'jarvis', { limit: 3 });
    expect(serper.url).toContain('serper');
    expect(serper.headers['X-API-KEY']).toBe('k');
    const brave = buildSearchRequest({ type: 'brave', apiKey: 'k2', enabled: true }, 'q');
    expect(brave.url).toContain('brave');
  });

  it('parses serper organic results', () => {
    const r = parseSearchResults('serper', { organic: [{ title: 'T', link: 'https://x', snippet: 'S' }] });
    expect(r[0]).toEqual({ title: 'T', url: 'https://x', snippet: 'S' });
  });
});
