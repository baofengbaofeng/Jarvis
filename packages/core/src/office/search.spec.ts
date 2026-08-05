import { describe, it, expect } from 'vitest';
import { ftsEscape, rankFts, type FtsRow } from './search';

describe('search', () => {
  it('escapes fts quotes', () => {
    expect(ftsEscape('say "hi"')).toBe('say ""hi""');
  });

  it('ranks title matches above snippet-only', () => {
    const rows: FtsRow[] = [
      { table: 'message', id: '1', title: 'irrelevant', snippet: 'contains jarvis keyword' },
      { table: 'message', id: '2', title: 'jarvis setup guide', snippet: 'steps' }
    ];
    const ranked = rankFts(rows, 'jarvis');
    expect(ranked[0].id).toBe('2');
  });
});
