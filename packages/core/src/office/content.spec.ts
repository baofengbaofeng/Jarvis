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

  it('degrades a non-data image url to a text placeholder for anthropic (media_type guard)', () => {
    // Regression: the pre-fix anthropic mapping did `url.split(';')[0]
    // .replace('data:','')` for ANY image_url, so an https URL produced the whole
    // URL as `media_type` with empty `data` (a broken base64 source block).
    const c = toContentArray('hi', ['https://x.com/a.png']);
    const anth = normalizeContent(c, 'anthropic') as Array<{ type: string; text?: string }>;
    expect(anth[1]).toEqual({ type: 'text', text: '[图片: https://x.com/a.png]' });
  });

  it('keeps a base64 data image as an anthropic image block', () => {
    const c = toContentArray('', ['data:image/jpeg;base64,AAA']);
    const anth = normalizeContent(c, 'anthropic') as Array<{ type: string; source?: { media_type?: string; data?: string } }>;
    expect(anth[0].type).toBe('image');
    expect(anth[0].source?.media_type).toBe('image/jpeg');
    expect(anth[0].source?.data).toBe('AAA');
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
    // An empty array is not a valid content message (toContentArray('') -> '').
    expect(isContentArray([])).toBe(false);
    // Malformed parts are rejected.
    expect(isContentArray([{ type: 'text' }])).toBe(false);
    expect(isContentArray([{ type: 'image_url', image_url: { url: 42 } }])).toBe(false);
  });
});
