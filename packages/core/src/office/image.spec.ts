import { describe, it, expect } from 'vitest';
import { createOpenAiImageAdapter } from './image';

describe('image adapter', () => {
  it('posts to images/generations and returns urls', async () => {
    const fetchImpl = async (_url: string, _init?: RequestInit) => ({
      ok: true, status: 200, json: async () => ({ data: [{ url: 'https://img/x.png' }] }), text: async () => ''
    }) as Response;
    const adapter = createOpenAiImageAdapter({ apiKey: 'sk-test', fetchImpl: fetchImpl as never });
    const urls = await adapter.generate({ prompt: 'a cat' });
    expect(urls[0].url).toContain('img/x.png');
  });

  it('throws on non-ok response', async () => {
    const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => 'boom' }) as Response;
    const adapter = createOpenAiImageAdapter({ apiKey: 'k', fetchImpl: fetchImpl as never });
    await expect(adapter.generate({ prompt: 'x' })).rejects.toThrow('500');
  });
});
