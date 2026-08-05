import { readFileSync } from 'node:fs';
import type Database from 'better-sqlite3';
// The MAIN process runs in Node/Electron, where the pdfjs-dist browser build
// (build/pdf.mjs) references browser-only globals (DOMMatrix) at module scope and
// throws. The legacy build is the Node entry point — same getDocument API, no
// DOM at import time. The renderer keeps the browser build (see PdfReaderPage).
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createAdapter, chatText, buildSelectionPrompt, buildWritingPrompt, translateWhileTyping, chunkPages, buildPdfSummaryPrompt, extractMainText, isHttpUrl, parseVideoUrl, fetchVideoMeta, summarizeVideo, createOpenAiImageAdapter, extractFileText, extractPptx, type ChatChunk, type ChatRequest, type Extractor, type ModelMessage, type ModelRole, type OfficeFileKind, type ProviderAdapter, type SelectionAction, type WritingAction, type VideoMeta } from '@jarvis/core';
import type { Provider } from '@jarvis/protocol';
import type { SecureStorage } from '../secrets/SecureStorage';
import type { SettingsStore } from './settings';

// Minimal surface the office.webview channels need from the WebView host. Kept
// as a structural type so office.ts does NOT statically import WebViewHost
// (which pulls 'electron' — see getWebViewHost below) and so tests can inject a
// fake. The real WebViewHost satisfies it.
export interface WebViewLike {
  open(url: string): Promise<void>;
  extract(): Promise<string>;
  close(): void;
  isOpen(): boolean;
}

// Lazy singleton: WebViewHost imports 'electron' (BrowserWindow/session), which
// Node cannot load, and office.spec.ts imports this module — so the import must
// stay out of the module graph until a webview channel actually runs. The
// dynamic import below is only reached from the Electron main process.
let cachedWebViewHost: WebViewLike | null = null;
async function getWebViewHost(): Promise<WebViewLike> {
  if (cachedWebViewHost) return cachedWebViewHost;
  const { WebViewHost } = await import('../webview/WebViewHost');
  cachedWebViewHost = new WebViewHost();
  return cachedWebViewHost;
}

// M5 Task 4 (I8/D8) one-click page summary orchestration: open → extract → clean
// → chat → close. The WebViewHost itself is Electron-only and manually verified
// in the running app, so the orchestration is extracted here as a pure-ish
// helper that takes the host + summarizer as injected deps — the try/finally
// close (no window leak on throw) and the empty-extract guard are unit-tested
// against a fake host in office.spec.ts.
export async function summarizeWebPage(
  url: string,
  web: { open(url: string): Promise<void>; extract(): Promise<string>; close(): void },
  summarize: (text: string) => Promise<string>
): Promise<{ ok: true; result: string } | { ok: false; error: string }> {
  try {
    if (!isHttpUrl(url)) return { ok: false, error: '只支持 http/https 网页地址' };
    await web.open(url);
    const raw = await web.extract();
    // extract() returns the rendered innerText — that is the primary text source
    // (D8 "生产优先 innerText"). extractMainText is the pure-function FALLBACK,
    // used only when the WebView returned no innerText (e.g. '' on a JS-driven
    // page before render): running its "keep 5 longest blocks" pass over plain
    // innerText would silently truncate a long article before the slice below.
    const text = raw.trim() || extractMainText(raw);
    if (!text) return { ok: false, error: '页面无可提取的正文内容' };
    const result = await summarize(text.slice(0, 12000));
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    web.close();
  }
}

// The office channels need a *streaming* chat surface (AsyncIterable of
// { deltaText }) that chatText drains, but the M4 ModelRouter.chat returns a
// single Promise<{ text, usage }>. Rather than re-wrap that, reuse the exact
// adapter path tasks.ts' defaultChatFn uses — createAdapter(req.provider.type)
// per request — and bridge the adapter's onChunk callback into an async
// generator. The adapter itself streams (it drives onChunk from its own SSE
// loop), so the generator just consumes the chunk queue as it fills.
export function createOfficeChatStream(db: Database.Database, secrets: SecureStorage): { chat(req: unknown): AsyncIterable<{ deltaText?: string }> } {
  return {
    async *chat(req) {
      const messages = (req as { messages?: Array<{ role: string; content: string }> }).messages ?? [];
      // Single-active-agent assumption: office requests carry no agentId, so
      // resolve the FIRST agent with a valid model binding (the same "current"
      // fallback the renderer agent store uses: agents[0]).
      const row = db.prepare(`
        SELECT m.model_id, p.id AS provider_id, p.name AS provider_name, p.base_url, p.type, p.api_key_ref, p.created_at, p.updated_at
        FROM agents a
        JOIN models m ON m.id = a.model_id
        JOIN providers p ON p.id = m.provider_id
        ORDER BY a.created_at ASC
        LIMIT 1
      `).get() as { model_id: string; provider_id: string; provider_name: string; base_url: string; type: 'openai-compatible' | 'anthropic-compatible'; api_key_ref: string; created_at: string; updated_at: string } | undefined;
      if (!row) throw new Error('no agent with a valid model binding');
      const apiKey = await secrets.get(row.api_key_ref);
      if (!apiKey) throw new Error('missing api key');
      const provider: Provider = {
        id: row.provider_id, name: row.provider_name, type: row.type, baseUrl: row.base_url,
        apiKeyRef: row.api_key_ref, createdAt: row.created_at, updatedAt: row.updated_at
      };
      const modelMessages: ModelMessage[] = messages.map(m => ({ role: m.role as ModelRole, content: m.content }));
      yield* streamAdapter({ provider, modelId: row.model_id, messages: modelMessages, stream: true }, apiKey);
    }
  };
}

// Bridge the ProviderAdapter's callback-based onChunk into an async generator
// yielding { deltaText } chunks. The adapter runs detached (its SSE loop pushes
// through onChunk); the generator consumes the queue, waiting on a one-shot
// waiter. The waiter re-checks the queue/error/done flags inside its executor so
// a chunk that lands between the checks above and the waiter assignment cannot
// be missed (wake() would have seen waiter === null).
//
// Cancellation: an AbortController is created per stream and its signal is
// forwarded to the adapter (same as tasks.ts' defaultChatFn forwards opts.signal).
// The consumer loop is wrapped in try/finally so the controller is aborted the
// moment the generator closes — whether on normal completion, a thrown chunk
// error, or an early consumer return/break. Without this, the detached
// adapter.chat() would keep streaming into the queue after the consumer moved
// on. The detached promise's rejection (an abort surfaces as a rejected fetch)
// is swallowed by the .catch below, so no unhandled rejection leaks.
export function streamAdapter(req: ChatRequest, apiKey: string, deps: { createAdapter?: (type: ChatRequest['provider']['type']) => ProviderAdapter } = {}): AsyncGenerator<{ deltaText?: string }> {
  const queue: string[] = [];
  let error: Error | null = null;
  let done = false;
  let waiter: (() => void) | null = null;
  const wake = () => { const w = waiter; waiter = null; w?.(); };
  const controller = new AbortController();

  const adapter = (deps.createAdapter ?? createAdapter)(req.provider.type);
  void adapter.chat(req, {
    apiKey,
    signal: controller.signal,
    onChunk: (c: ChatChunk) => {
      if (c.kind === 'delta') queue.push(c.delta);
      else if (c.kind === 'error') error = new Error(c.error);
      else if (c.kind === 'done') done = true;
      wake();
    }
  }).catch((e: unknown) => { error = e instanceof Error ? e : new Error(String(e)); wake(); });

  return (async function* () {
    try {
      while (true) {
        if (queue.length) yield { deltaText: queue.shift() };
        if (error) throw error;
        if (done) return;
        await new Promise<void>((r) => {
          waiter = r;
          if (queue.length || error || done) { waiter = null; r(); }
        });
      }
    } finally {
      // Consumer closed (return/break/throw): stop the adapter from streaming
      // into the queue any longer.
      controller.abort();
    }
  })();
}

// Shared main-side PDF reader for the office channels. readFileSync loads the
// raw bytes (PDFs are binary, no encoding), getDocument parses the file, then we
// walk every page and join each page's text items with a space — PDF text items
// don't carry reliable line breaks, so a space approximates reading order. Both
// office.pdf.extract (raw page texts) and office.pdf.summarize (chunk + chatText)
// reuse this so the pdfjs-dist surface stays in one place.
export async function extractPdf(path: string): Promise<{ pages: number; pageTexts: string[] }> {
  const data = new Uint8Array(readFileSync(path));
  const doc = await getDocument({ data }).promise;
  const pages = doc.numPages;
  const pageTexts: string[] = [];
  try {
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      // TextMarkedContent (outlines/links) carries no str; treat it as empty.
      pageTexts.push((content.items as Array<{ str?: string }>).map((it) => it.str ?? '').join(' '));
    }
  } finally {
    // pdfjs-dist v6: PDFDocumentProxy has no destroy(); the owning loading task
    // does. Releasing the worker after a one-shot extract avoids a leaked parse.
    void doc.loadingTask.destroy();
  }
  return { pages, pageTexts };
}

// D9 transcript (Whisper/API) is an OPTIONAL integration, out of scope for M5.
// Until a transcript source is configured this returns undefined, so
// summarizeVideo throws its clear "no transcript" error and the
// office.video.summarize channel returns { ok:false } instead of silently
// sending an empty prompt to chatText.
export async function getTranscript(_meta: VideoMeta): Promise<string | undefined> {
  return undefined;
}

// D10 image-generation API key. There is no image-provider settings UI yet, so
// the key is configured as a keychain ref under settings `image.api_key_ref`
// (the same api_key_ref → SecureStorage pattern providers.ts uses for provider
// keys). No ref configured → null → the channel returns a clear { ok:false }
// error (D10: do not silently fail).
async function resolveImageApiKey(settings: SettingsStore | undefined, secrets: Pick<SecureStorage, 'get'> | undefined): Promise<string | null> {
  const ref = settings?.get('image.api_key_ref') as string | undefined;
  if (!ref || !secrets) return null;
  return (await secrets.get(ref)) ?? null;
}

export function registerOfficeIpc(router: { register(ch: string, h: (...a: unknown[]) => unknown): void }, modelRouter: { chat(req: unknown): AsyncIterable<{ deltaText?: string }> }, deps: { getWebViewHost?: () => Promise<WebViewLike>; settings?: SettingsStore; secrets?: Pick<SecureStorage, 'get'>; imageFetch?: typeof fetch } = {}) {
  // deps.getWebViewHost lets tests inject a fake host; production uses the lazy
  // dynamic-import singleton (see getWebViewHost above).
  const getWeb = deps.getWebViewHost ?? getWebViewHost;
  // The router's generic handler type is (...a: unknown[]) => unknown, but the
  // handler below narrows its second arg; cast it so strictFunctionTypes accepts
  // the assignment (the IpcRouter wrapper passes the electron event + payload).
  router.register('office.selection', (async (_e, req: { text: string; action: SelectionAction; targetLang?: string }) => {
    const prompt = buildSelectionPrompt(req);
    const result = await chatText(modelRouter, [{ role: 'system', content: '你是专业助手。' }, { role: 'user', content: prompt }]);
    return { ok: true, result };
  }) as (...a: unknown[]) => unknown);
  // M5 Task 2 (D5/D6): AI 写作 + 边写边译. Same chatText drain over the same
  // streaming modelRouter bridge as office.selection.
  router.register('office.writing', (async (_e, req: { action: WritingAction; text: string; lang?: string }) => {
    const result = await chatText(modelRouter, [{ role: 'user', content: buildWritingPrompt(req.action, req.text, req.lang) }]);
    return { ok: true, result };
  }) as (...a: unknown[]) => unknown);
  router.register('office.writing.translate', (async (_e, text: string, lang: string) => {
    const { done, pending } = await translateWhileTyping(text, lang, async (p) => {
      return chatText(modelRouter, [{ role: 'user', content: buildWritingPrompt('translate', p, lang) }]);
    });
    return { ok: true, done, pending };
  }) as (...a: unknown[]) => unknown);
  // M5 Task 3 (D7): PDF 伴读 — page text extraction + summarization. extract
  // returns every page's text; summarize slices the requested page range (1-based
  // inclusive), chunks it by character budget, and drains each chunk through the
  // same chatText bridge as the other office channels. Errors (missing file, pdf
  // parse failure) are caught and returned as { ok: false, error } so the
  // renderer can surface them without an unhandled rejection.
  router.register('office.pdf.extract', (async (_e, path: string) => {
    try {
      const ext = await extractPdf(path);
      // The renderer re-loads the doc with pdfjs-dist to paint the page to a
      // canvas, so ship the raw bytes alongside the page texts. extractPdf
      // already threw on a missing/unreadable file before this, so the second
      // read is cheap and safe.
      const data = readFileSync(path).toString('base64');
      return { ok: true, ...ext, data };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }) as (...a: unknown[]) => unknown);
  router.register('office.pdf.summarize', (async (_e, path: string, from: number, to: number) => {
    try {
      const { pageTexts } = await extractPdf(path);
      const chunks = chunkPages(pageTexts.slice(from - 1, to));
      const out: string[] = [];
      for (const c of chunks) {
        // chunkPages is 1-based within the slice; add (from - 1) to rebase chunk
        // page numbers back onto the document's absolute page numbers.
        out.push(await chatText(modelRouter, [{ role: 'user', content: buildPdfSummaryPrompt(undefined, { from: c.from + from - 1, to: c.to + from - 1 }, c.texts) }]));
      }
      return { ok: true, result: out.join('\n\n---\n\n') };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }) as (...a: unknown[]) => unknown);
  // M5 Task 4 (I8/D8): session-isolated WebView + one-click page summary. Both
  // channels accept a user URL — gate it to http(s) so file:/javascript:/data:
  // can't be loaded into the sandboxed window. open leaves the window up (the
  // feature is "open this page"); summarize drives the full open → extract →
  // chat → close cycle through summarizeWebPage (which always closes, even on
  // error).
  router.register('office.webview.open', (async (_e, url: string) => {
    if (!isHttpUrl(url)) return { ok: false, error: '只支持 http/https 网页地址' };
    const web = await getWeb();
    try {
      await web.open(url);
      return { ok: true };
    } catch (e) {
      web.close();
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }) as (...a: unknown[]) => unknown);
  router.register('office.webview.summarize', (async (_e, url: string) => {
    const web = await getWeb();
    return summarizeWebPage(url, web, async (text) => {
      return chatText(modelRouter, [{ role: 'user', content: `请总结下面网页内容,给出要点:\n\n${text}` }]);
    });
  }) as (...a: unknown[]) => unknown);
  // M5 Task 5 (D9): video link summary. oEmbed (global fetch in main) pulls the
  // video title; getTranscript is a stub (Whisper/API out of scope), so
  // summarizeVideo throws the clear "no transcript" error and the catch returns
  // { ok:false } instead of an unhandled rejection. chatText only runs when a
  // transcript actually exists — no empty/undefined prompt is ever sent.
  router.register('office.video.summarize', (async (_e, url: string) => {
    try {
      const meta = await fetchVideoMeta(url, parseVideoUrl, async (u) => {
        const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(u)}&format=json`).catch(() => null);
        return r && r.ok ? (await r.json() as { title?: string }) : null;
      });
      const transcript = await getTranscript(meta);
      const prompt = summarizeVideo(meta, transcript);
      const result = await chatText(modelRouter, [{ role: 'user', content: prompt }]);
      return { ok: true, meta, result };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }) as (...a: unknown[]) => unknown);
  // M5 Task 5 (D10): image generation via an OpenAI-compatible endpoint only
  // (extensible behind the ImageAdapter interface). resolveImageApiKey reads the
  // keychain ref from settings (no settings UI yet → clear { ok:false } error).
  // The renderer sends size as a plain string; validate it against the adapter's
  // allowed set rather than casting. imageFetch is injected for tests; production
  // falls back to the global fetch.
  router.register('office.image.generate', (async (_e, req: { prompt: string; size?: string }) => {
    try {
      const key = await resolveImageApiKey(deps.settings, deps.secrets);
      if (!key) return { ok: false, error: '未配置图像生成 API Key(见设置→办公→图像)。' };
      const size = req.size === '256x256' || req.size === '512x512' || req.size === '1024x1024' ? req.size : undefined;
      const urls = await createOpenAiImageAdapter({ apiKey: key, fetchImpl: deps.imageFetch }).generate({ prompt: req.prompt, size });
      return { ok: true, urls };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }) as (...a: unknown[]) => unknown);
  // M5 Task 7 (D12): file upload analysis. The renderer sends the OS path plus
  // the ORIGINAL name (a dropped file can arrive under a temp name), so
  // classification keys on `name`, not `path`. Every extractor runs on the MAIN
  // side (pdfjs-dist, mammoth, xlsx, jszip are Node deps; core stays
  // parser-agnostic via extractFileText's injected-extractor design). Any
  // failure — missing file, parser error, chatText error, unsupported kind — is
  // caught and returned as { ok:false, error } so the IPC never rejects.
  router.register('office.file.analyze', (async (_e, path: string, name: string) => {
    try {
      const extractors: Partial<Record<OfficeFileKind, Extractor>> = {
        // extractPdf (Task 3) returns per-page texts; join for a flat document.
        pdf: async () => (await extractPdf(path)).pageTexts.join('\n'),
        docx: async () => (await import('mammoth')).extractRawText({ path }).then(r => r.value),
        xlsx: async () => {
          // sheet_to_csv renders each sheet's cell grid as comma-separated rows —
          // the simplest faithful text surface for a spreadsheet (formulae come
          // through as their cached values, matching what a human sees).
          const XLSX = await import('xlsx');
          const wb = XLSX.readFile(path);
          return wb.SheetNames.map(sn => XLSX.utils.sheet_to_csv(wb.Sheets[sn])).filter(Boolean).join('\n');
        },
        pptx: async () => {
          const JSZip = await import('jszip');
          // extractPptx takes an injected unzip so core never depends on jszip.
          const unzip = async (b: ArrayBuffer) => {
            const zip = await JSZip.loadAsync(b);
            return { file: async (n: string) => { const f = zip.file(n); return f ? await f.async('string') : null; } };
          };
          const data = readFileSync(path);
          return extractPptx(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), unzip);
        },
      };
      const text = await extractFileText({ path, name }, extractors);
      const result = await chatText(modelRouter, [{ role: 'user', content: `请分析下面文件内容并给出要点:\n\n${text.slice(0, 12000)}` }]);
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }) as (...a: unknown[]) => unknown);
}
