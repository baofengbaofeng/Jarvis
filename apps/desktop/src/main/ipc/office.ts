import type Database from 'better-sqlite3';
import { createAdapter, chatText, buildSelectionPrompt, buildWritingPrompt, translateWhileTyping, type ChatChunk, type ChatRequest, type ModelMessage, type ModelRole, type ProviderAdapter, type SelectionAction, type WritingAction } from '@jarvis/core';
import type { Provider } from '@jarvis/protocol';
import type { SecureStorage } from '../secrets/SecureStorage';

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

export function registerOfficeIpc(router: { register(ch: string, h: (...a: unknown[]) => unknown): void }, modelRouter: { chat(req: unknown): AsyncIterable<{ deltaText?: string }> }) {
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
}
