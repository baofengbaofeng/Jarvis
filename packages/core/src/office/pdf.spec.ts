import { describe, it, expect } from 'vitest';
import { chunkPages, buildPdfSummaryPrompt } from './pdf';

describe('pdf helpers', () => {
  it('chunks pages by char budget', () => {
    const pages = ['a'.repeat(3000), 'b'.repeat(3000), 'c'.repeat(3000)];
    const chunks = chunkPages(pages, 4000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].from).toBe(1);
    expect(chunks[0].to).toBe(1);
  });

  it('builds a structured summary prompt', () => {
    const p = buildPdfSummaryPrompt('book', { from: 1, to: 2 }, ['page one', 'page two']);
    expect(p).toContain('book');
    expect(p).toContain('page one');
    expect(p).toContain('中英对照');
  });
});
