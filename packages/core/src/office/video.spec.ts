import { describe, it, expect } from 'vitest';
import { parseVideoUrl, fetchVideoMeta, summarizeVideo } from './video';

describe('video', () => {
  it('parses youtube and bilibili urls', () => {
    expect(parseVideoUrl('https://youtu.be/abc123').id).toBe('abc123');
    expect(parseVideoUrl('https://www.youtube.com/watch?v=xyz456').id).toBe('xyz456');
    expect(parseVideoUrl('https://www.bilibili.com/video/BV1xx411c7mD').id).toBe('BV1xx411c7mD');
    expect(parseVideoUrl('https://example.com/x').platform).toBe('unknown');
  });

  it('fetches metadata title via oembed', async () => {
    const meta = await fetchVideoMeta('https://www.youtube.com/watch?v=xyz456', parseVideoUrl, async () => ({ title: 'How to X' }));
    expect(meta.platform).toBe('youtube');
    expect(meta.id).toBe('xyz456');
    expect(meta.title).toBe('How to X');
  });

  it('skips oembed for unknown platforms', async () => {
    let called = false;
    const meta = await fetchVideoMeta('https://example.com/x', parseVideoUrl, async () => { called = true; return { title: 'nope' }; });
    expect(meta.platform).toBe('unknown');
    expect(meta.id).toBeNull();
    expect(called).toBe(false);
  });

  it('errors clearly when no transcript is available', () => {
    const meta = { platform: 'youtube' as const, id: 'abc123' };
    expect(() => summarizeVideo(meta, undefined)).toThrow('transcript');
    const p = summarizeVideo(meta, 'full transcript text');
    expect(p).toContain('full transcript text');
  });
});
