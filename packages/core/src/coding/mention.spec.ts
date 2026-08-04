import { describe, it, expect } from 'vitest';
import { parseMentions, resolveFileMention, buildMentionBlock } from './mention';

describe('mention', () => {
  it('parses @file mentions from text', () => {
    const m = parseMentions('请阅读 @src/a.ts 并参考 @docs/guide.md 摘要');
    expect(m.map(x => x.query)).toEqual(['src/a.ts', 'docs/guide.md']);
  });

  it('resolves a file mention to a content attachment', () => {
    const files = new Map([['/ws/src/a.ts', 'export const x = 1;']]);
    const att = resolveFileMention('src/a.ts', '/ws', (p) => files.get(p) ?? null);
    expect(att.type).toBe('file');
    expect(att.content).toContain('export const x');
  });

  it('throws on missing file', () => {
    expect(() => resolveFileMention('nope.ts', '/ws', () => null)).toThrow('not found');
  });

  it('builds an injection block with sources', () => {
    const block = buildMentionBlock([{ type: 'file', source: 'src/a.ts', content: 'export const x = 1;' }]);
    expect(block).toContain('<referenced>');
    expect(block).toContain('src/a.ts');
    expect(buildMentionBlock([])).toBe('');
  });
});
