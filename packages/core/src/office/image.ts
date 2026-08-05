// Pure OpenAI-compatible image-generation adapter for the office.image channel
// (D10). Renderer-safe (no node:* imports; `fetch` is a global). Only the
// OpenAI-compatible /images/generations shape is supported; other providers are
// future work behind the same ImageAdapter interface.

export interface ImageRequest { prompt: string; size?: '256x256' | '512x512' | '1024x1024'; n?: number }
export interface ImageAdapter { generate(req: ImageRequest): Promise<Array<{ url: string }>> }
export class ImageError extends Error {}

export interface OpenAiImageDeps { apiKey: string; baseUrl?: string; model?: string; fetchImpl?: typeof fetch }

export function createOpenAiImageAdapter(deps: OpenAiImageDeps): ImageAdapter {
  const f = deps.fetchImpl ?? fetch;
  return {
    async generate(req) {
      const res = await f(`${deps.baseUrl ?? 'https://api.openai.com/v1'}/images/generations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${deps.apiKey}` },
        body: JSON.stringify({ model: deps.model ?? 'dall-e-3', prompt: req.prompt, size: req.size ?? '1024x1024', n: req.n ?? 1 })
      });
      if (!res.ok) throw new ImageError(`image gen failed ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { data: Array<{ url: string }> };
      return data.data;
    }
  };
}
