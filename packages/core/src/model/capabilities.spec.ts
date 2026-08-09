import { describe, it, expect } from 'vitest';
import { gateModelCapabilities } from './capabilities';
import { contentHasImages } from '../office/content';

describe('gateModelCapabilities', () => {
  it('applies maxOutputTokens when explicit maxTokens absent', () => {
    const r = gateModelCapabilities({
      capabilities: { maxOutputTokens: 2048, supportsTools: true, supportsImages: false },
      hasToolsAvailable: false,
      hasImages: false,
    });
    expect(r.maxTokens).toBe(2048);
    expect(r.error).toBeUndefined();
  });

  it('keeps explicit maxTokens over model default', () => {
    const r = gateModelCapabilities({
      capabilities: { maxOutputTokens: 2048, supportsTools: true, supportsImages: false },
      explicitMaxTokens: 1,
      hasToolsAvailable: false,
      hasImages: false,
    });
    expect(r.maxTokens).toBe(1);
  });

  it('omits maxTokens when model unset and no explicit', () => {
    const r = gateModelCapabilities({
      capabilities: { maxOutputTokens: null, supportsTools: true, supportsImages: false },
      hasToolsAvailable: false,
      hasImages: false,
    });
    expect(r.maxTokens).toBeUndefined();
  });

  it('strips tools and notices when unsupported', () => {
    const r = gateModelCapabilities({
      capabilities: { supportsTools: false, supportsImages: false },
      hasToolsAvailable: true,
      hasImages: false,
    });
    expect(r.includeTools).toBe(false);
    expect(r.notice).toBe('MODEL_TOOLS_UNSUPPORTED');
  });

  it('hard-fails on images when unsupported', () => {
    const r = gateModelCapabilities({
      capabilities: { supportsTools: true, supportsImages: false },
      hasToolsAvailable: false,
      hasImages: true,
    });
    expect(r.error).toBe('MODEL_IMAGES_UNSUPPORTED');
  });
});

describe('contentHasImages', () => {
  it('detects image_url parts and ignores plain strings', () => {
    expect(contentHasImages('hello')).toBe(false);
    expect(contentHasImages([{ type: 'text', text: 'hi' }])).toBe(false);
    expect(contentHasImages([
      { type: 'text', text: 'hi' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AA' } },
    ])).toBe(true);
  });
});
