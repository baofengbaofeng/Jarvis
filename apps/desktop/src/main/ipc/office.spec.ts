import { describe, it, expect } from 'vitest';
import type { ChatRequest, ProviderAdapter } from '@jarvis/core';
import { streamAdapter, summarizeWebPage, registerOfficeIpc, resolveCjsDefault } from './office';

const req: ChatRequest = {
  provider: { id: 'p1', name: 'P', type: 'openai-compatible', baseUrl: 'https://x.com', apiKeyRef: 'ref', createdAt: '', updatedAt: '' },
  modelId: 'm1',
  messages: [],
  stream: true
};

describe('streamAdapter', () => {
  it('yields deltas and completes on done', async () => {
    const adapter: ProviderAdapter = {
      type: 'openai-compatible',
      async chat(_req, ctx) {
        ctx.onChunk({ kind: 'delta', delta: 'ab' });
        ctx.onChunk({ kind: 'done' });
      }
    };
    const gen = streamAdapter(req, 'key', { createAdapter: () => adapter });
    const out: string[] = [];
    for await (const c of gen) out.push(c.deltaText ?? '');
    expect(out.join('')).toBe('ab');
  });

  it('aborts the adapter when the consumer closes the generator early', async () => {
    let signal: AbortSignal | undefined;
    const adapter: ProviderAdapter = {
      type: 'openai-compatible',
      async chat(_req, ctx) {
        signal = ctx.signal;
        // Yield one delta then keep the stream open so the generator suspends at
        // a yield point — the only place a consumer break/return can interrupt it
        // (an internal-await suspension would not process return() until it
        // resolves). The abort fires from the generator's finally on close.
        ctx.onChunk({ kind: 'delta', delta: 'a' });
        await new Promise<void>((_, reject) => {
          ctx.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }
    };
    const gen = streamAdapter(req, 'key', { createAdapter: () => adapter });
    const first = await gen.next(); // consume the first delta
    expect(first.value?.deltaText).toBe('a');
    await gen.return(undefined); // consumer closes -> finally -> controller.abort()
    expect(signal?.aborted).toBe(true);
  });

  it('throws the adapter error to the consumer', async () => {
    const adapter: ProviderAdapter = {
      type: 'openai-compatible',
      async chat(_req, ctx) {
        ctx.onChunk({ kind: 'error', error: 'boom' });
      }
    };
    const gen = streamAdapter(req, 'key', { createAdapter: () => adapter });
    await expect(async () => {
      for await (const _c of gen) { /* drain */ }
    }).rejects.toThrow('boom');
  });
});

// M5 Task 4 (I8/D8): summarizeWebPage orchestrates open → extract → clean →
// chat → close. The real WebViewHost is Electron-only and manually verified; the
// orchestration (incl. try/finally close and URL validation) is covered here
// with an injected fake host.
describe('summarizeWebPage', () => {
  // The WebView's extract() returns the rendered page innerText (plain text, no
  // tags) — that is the primary source for the summary (D8 生产优先 innerText).
  const innerText = '这是正文第一段,包含足够多的文字内容以便被选中为正文主体。\n这是正文第二段,继续提供更多有意义的句子来支撑正文提取逻辑的判断。';

  it('prefers extract() innerText, summarizes and always closes', async () => {
    const calls: string[] = [];
    const web = {
      open: async () => { calls.push('open'); },
      extract: async () => innerText,
      close: () => { calls.push('close'); }
    };
    const result = await summarizeWebPage('https://example.com/article', web, async (text) => {
      calls.push('summarize');
      // innerText passes through untouched (no truncation, no cleaning).
      expect(text).toBe(innerText);
      expect(text).toContain('这是正文第一段');
      return 'summary';
    });
    expect(result).toEqual({ ok: true, result: 'summary' });
    expect(calls).toEqual(['open', 'summarize', 'close']);
  });

  it('whitespace-only extract() (raw.trim() falsy) yields the empty-extract error', async () => {
    // raw.trim() || extractMainText(raw): extractMainText only sees the
    // extract() return (innerText) — it cannot resurrect content the page never
    // produced, so a blank innerText still errors out. HTML cleaning (nav/menu
    // dropping) is extractMainText's own job and is unit-tested in
    // packages/core/src/office/webpage.spec.ts.
    const web = { open: async () => {}, extract: async () => '  \n  ', close: () => {} };
    const result = await summarizeWebPage('https://example.com/article', web, async () => 'summary');
    expect(result).toEqual({ ok: false, error: '页面无可提取的正文内容' });
  });

  it('does not truncate a long multi-paragraph innerText to 5 blocks', async () => {
    // Regression: extractMainText keeps only the 5 longest blocks — if it ran
    // over plain innerText, paragraphs 6+ would never reach the model. The
    // summarize path must pass innerText through whole (the 12000-char slice is
    // the only cut).
    const paragraphs = Array.from({ length: 12 }, (_, i) => `这是第${i + 1}段正文内容,包含足够多的文字内容以便被选中为正文主体。`);
    const longText = paragraphs.join('\n');
    const web = { open: async () => {}, extract: async () => longText, close: () => {} };
    let seen = '';
    const result = await summarizeWebPage('https://example.com/article', web, async (text) => { seen = text; return 'summary'; });
    expect(result).toEqual({ ok: true, result: 'summary' });
    expect(seen).toContain('这是第1段正文内容');
    expect(seen).toContain('这是第8段正文内容');
    expect(seen).toContain('这是第12段正文内容');
  });

  it('rejects non-http URLs without opening the window', async () => {
    let opened = false;
    const web = { open: async () => { opened = true; }, extract: async () => '', close: () => {} };
    const result = await summarizeWebPage('file:///etc/passwd', web, async () => 'x');
    expect(result).toEqual({ ok: false, error: '只支持 http/https 网页地址' });
    expect(opened).toBe(false);
  });

  it('still closes the host when extraction throws', async () => {
    let closed = 0;
    const web = { open: async () => {}, extract: async () => { throw new Error('boom'); }, close: () => { closed++; } };
    const result = await summarizeWebPage('https://example.com', web, async () => 'x');
    expect(result).toEqual({ ok: false, error: 'boom' });
    expect(closed).toBe(1);
  });

  it('returns an error when no text is extractable', async () => {
    let closed = 0;
    const web = { open: async () => {}, extract: async () => '', close: () => { closed++; } };
    const result = await summarizeWebPage('https://example.com', web, async () => 'x');
    expect(result).toEqual({ ok: false, error: '页面无可提取的正文内容' });
    expect(closed).toBe(1);
  });
});

// M5 Task 5 (D9/D10): the video.summarize and image.generate channels.
// registerOfficeIpc registers handlers against a captured fake router so we can
// invoke them directly — no Electron, no network (unknown-platform URL makes
// fetchVideoMeta short-circuit before the injected youtube oEmbed fetch).
function makeRouter() {
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  return { handlers, register: (ch: string, h: (...a: unknown[]) => unknown) => { handlers.set(ch, h); } };
}

describe('office video/image channels', () => {
  it('video.summarize returns the clear no-transcript error and never calls chatText', async () => {
    const router = makeRouter();
    const chatCalls: unknown[] = [];
    const modelRouter = { async *chat(req: unknown) { chatCalls.push(req); } };
    registerOfficeIpc(router, modelRouter);
    const h = router.handlers.get('office.video.summarize')!;
    // Unknown platform short-circuits the oEmbed fetch, so this never hits the
    // network — the channel still surfaces the D9 transcript error via getTranscript stub.
    const res = await h({} as never, 'https://example.com/x');
    expect(res).toEqual({ ok: false, error: expect.stringContaining('transcript') });
    expect(chatCalls).toHaveLength(0);
  });

  it('image.generate returns a clear error when no image API key is configured', async () => {
    const router = makeRouter();
    registerOfficeIpc(router, { async *chat() {} });
    const h = router.handlers.get('office.image.generate')!;
    const res = await h({} as never, { prompt: 'a cat' });
    expect(res).toEqual({ ok: false, error: expect.stringContaining('API Key') });
  });

  it('image.generate returns urls when an image API key is configured', async () => {
    const router = makeRouter();
    const settings = { get: (key: string) => (key === 'image.api_key_ref' ? 'img:key' : undefined), set: () => {}, getAll: () => ({}) };
    const secrets = { get: async (ref: string) => (ref === 'img:key' ? 'sk-img' : null) };
    const imageFetch = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ url: 'https://img/y.png' }] }), text: async () => '' }) as Response;
    registerOfficeIpc(router, { async *chat() {} }, { settings, secrets, imageFetch });
    const h = router.handlers.get('office.image.generate')!;
    const res = await h({} as never, { prompt: 'a cat', size: '512x512' });
    expect(res).toEqual({ ok: true, urls: [{ url: 'https://img/y.png' }] });
  });

  it('image.generate rejects an invalid size rather than casting it', async () => {
    const router = makeRouter();
    let capturedInit: RequestInit | undefined;
    const imageFetch = async (_input: RequestInfo | URL, init?: RequestInit) => { capturedInit = init; return { ok: true, status: 200, json: async () => ({ data: [{ url: 'https://img/z.png' }] }), text: async () => '' } as Response; };
    const settings = { get: (key: string) => (key === 'image.api_key_ref' ? 'img:key' : undefined), set: () => {}, getAll: () => ({}) };
    const secrets = { get: async (ref: string) => (ref === 'img:key' ? 'sk-img' : null) };
    registerOfficeIpc(router, { async *chat() {} }, { settings, secrets, imageFetch });
    const h = router.handlers.get('office.image.generate')!;
    const res = await h({} as never, { prompt: 'a cat', size: 'garbage' });
    expect(res).toEqual({ ok: true, urls: [{ url: 'https://img/z.png' }] });
    const body = JSON.parse(String(capturedInit?.body)) as { size?: string };
    expect(body.size).toBe('1024x1024');
  });
});

// M5 Task 7 (D12): office.file.analyze routes by the ORIGINAL file name (drops
// may carry a temp path), extracts text with the main-side parsers, then drains
// it through chatText. Unsupported kinds must surface the clear extractFileText
// error and never call chatText (no empty/undefined prompt). A real docx/xlsx/
// pptx extraction would need binary fixtures — the routing contract is covered
// here and in packages/core/src/office/files.spec.ts.
describe('office.file.analyze', () => {
  it('returns the unsupported-type error for an unclassifiable file and never calls chatText', async () => {
    const router = makeRouter();
    const chatCalls: unknown[] = [];
    const modelRouter = { async *chat(req: unknown) { chatCalls.push(req); } };
    registerOfficeIpc(router, modelRouter);
    const h = router.handlers.get('office.file.analyze')!;
    const res = await h({} as never, '/tmp/notes.txt', 'notes.txt');
    expect(res).toEqual({ ok: false, error: 'unsupported file type: other' });
    expect(chatCalls).toHaveLength(0);
  });
});

// M5 final review — xlsx/jszip ESM/CJS interop regression. The office.file.analyze
// xlsx/pptx extractors used to call `mod.readFile` / `mod.loadAsync` directly on
// the ESM namespace returned by `await import('xlsx'/'jszip')`. Those packages
// are CommonJS; under Node's ESM/CJS interop the real functions live on
// `mod.default`, and the named exports may NOT be hoisted onto the namespace (the
// old code silently failed at runtime in the Electron main process). These tests
// exercise the exact `resolveCjsDefault` resolution the extractors use and assert
// the property is a callable — no file parsing, just the interop shape. They fail
// if the resolution ever yields a namespace without the member.
describe('xlsx/jszip ESM/CJS interop (regression)', () => {
  it('xlsx: resolveCjsDefault exposes readFile as a function', async () => {
    const XLSX = resolveCjsDefault(await import('xlsx'));
    expect(typeof XLSX.readFile).toBe('function');
  });

  it('jszip: resolveCjsDefault exposes loadAsync as a function', async () => {
    const JSZip = resolveCjsDefault(await import('jszip'));
    expect(typeof JSZip.loadAsync).toBe('function');
  });
});
