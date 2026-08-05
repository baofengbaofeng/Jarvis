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

  // A 200 body without the expected top-level key (bing webPages / brave web)
  // must parse to [] — the previous cast-and-deref threw a TypeError.
  it('parses bing/brave bodies missing the top-level key as an empty list', () => {
    expect(parseSearchResults('bing', {})).toEqual([]);
    expect(parseSearchResults('brave', {})).toEqual([]);
  });
});
