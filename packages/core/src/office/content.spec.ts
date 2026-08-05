import { describe, it, expect } from 'vitest';
import { toContentArray, isImageUrl, normalizeContent, isContentArray } from './content';

describe('multimodal content', () => {
  it('builds content array with text and images', () => {
    const c = toContentArray('hi', ['data:image/png;base64,AAA']);
    expect(Array.isArray(c)).toBe(true);
    if (Array.isArray(c)) {
      expect(c[0]).toEqual({ type: 'text', text: 'hi' });
      expect(c[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } });
    }
  });

  it('detects image urls', () => {
    expect(isImageUrl('data:image/png;base64,AAA')).toBe(true);
    expect(isImageUrl('https://x.com/a.png')).toBe(true);
    expect(isImageUrl('plain text')).toBe(false);
  });

  it('normalizes to openai and anthropic shapes', () => {
    const c = toContentArray('hi', ['data:image/png;base64,AAA']);
    const openai = normalizeContent(c, 'openai');
    const anth = normalizeContent(c, 'anthropic');
    expect(JSON.stringify(openai)).toContain('image_url');
    expect(JSON.stringify(anth)).toContain('image');
  });

  it('returns a plain string when there are no parts', () => {
    const c = toContentArray('', []);
    expect(typeof c).toBe('string');
  });

  it('guards the content-array shape used for DB round-tripping', () => {
    expect(isContentArray(toContentArray('hi', ['data:image/png;base64,AAA']))).toBe(true);
    expect(isContentArray('hi')).toBe(false);
    expect(isContentArray([{ type: 'text', text: 'hi' }])).toBe(true);
    // A JSON-looking string is NOT a content array.
    expect(isContentArray('[{"type":"text","text":"hi"}]')).toBe(false);
    // Malformed parts are rejected.
    expect(isContentArray([{ type: 'text' }])).toBe(false);
    expect(isContentArray([{ type: 'image_url', image_url: { url: 42 } }])).toBe(false);
  });
});
