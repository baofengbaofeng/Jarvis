import { describe, it, expect } from 'vitest';
import type { ChatRequest, ProviderAdapter } from '@jarvis/core';
import { streamAdapter, summarizeWebPage } from './office';

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
