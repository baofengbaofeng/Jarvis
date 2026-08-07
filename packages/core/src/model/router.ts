import type { ChatRequest, ChatChunk, ProviderAdapter, Usage } from './types';
import { createAdapter } from './adapters/index';

export class RetryableError extends Error {}
export class TimeoutError extends Error {}

export interface ProviderPolicy { timeoutMs: number; maxRetries: number; circuitBreaker: boolean }

export interface RouterDeps { createAdapter?: (type: ChatRequest['provider']['type'], deps?: { fetchImpl?: typeof fetch }) => ProviderAdapter }
export interface RouterChatOpts {
  apiKeyResolver: (ref: string) => Promise<string | null>;
  policy?: ProviderPolicy;
  onChunk?: (c: ChatChunk) => void;
  fallbackModelIds?: string[];
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_POLICY: ProviderPolicy = { timeoutMs: 60_000, maxRetries: 2, circuitBreaker: false };

export class ModelRouter {
  private failures = new Map<string, number>();
  private deps: RouterDeps;

  constructor(deps: RouterDeps = {}) {
    this.deps = deps;
  }

  async chat(req: ChatRequest, opts: RouterChatOpts): Promise<{ text: string; usage: Usage | null }> {
    const policy = { ...DEFAULT_POLICY, ...opts.policy };
    if (policy.circuitBreaker && (this.failures.get(req.provider.id) ?? 0) > 5) throw new Error('circuit open');
    // Resolve the API key before creating an adapter: interleaved chat() calls
    // must never read a shared adapter field after an await.
    const apiKey = await opts.apiKeyResolver(req.provider.apiKeyRef);
    if (!apiKey) throw new Error(`missing api key for provider ${req.provider.name}`);
    const models = [req.modelId, ...(opts.fallbackModelIds ?? [])];
    let lastError: Error | null = null;
    for (const modelId of models) {
      for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
        const adapter = (this.deps.createAdapter ?? createAdapter)(req.provider.type);
        try {
          const text = await this.runOnce(adapter, { ...req, modelId }, apiKey, policy, opts.onChunk);
          this.failures.delete(req.provider.id);
          return text;
        } catch (e) {
          lastError = e as Error;
          if (e instanceof RetryableError || e instanceof TimeoutError) {
            this.failures.set(req.provider.id, (this.failures.get(req.provider.id) ?? 0) + 1);
            continue;
          }
          break;
        }
      }
    }
    throw lastError ?? new Error('chat failed');
  }

  private runOnce(adapter: ProviderAdapter, req: ChatRequest, apiKey: string, policy: ProviderPolicy, onChunk?: (c: ChatChunk) => void): Promise<{ text: string; usage: Usage | null }> {
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), policy.timeoutMs);
      let text = '';
      let usage: Usage | null = null;
      adapter.chat(req, {
        apiKey,
        signal: controller.signal,
        onChunk: (c) => {
          if (c.kind === 'delta') text += c.delta;
          else if (c.kind === 'usage') usage = c.usage;
          // CORE-03: tool-argument parse failures arrive as soft error chunks
          // alongside a tool_call marked with argumentsParseError. Forward them
          // to the caller; do not abort the stream (provider failures still
          // throw from adapter.chat and are classified below).
          onChunk?.(c);
        }
      }).then(() => { clearTimeout(timer); resolve({ text, usage }); })
        .catch((e) => {
          clearTimeout(timer);
          if (controller.signal.aborted) reject(new TimeoutError('timeout'));
          else reject(e instanceof RetryableError ? e : classifyError(e));
        });
    });
  }
}

function classifyError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (RETRYABLE_STATUS.has(statusFromMsg(msg))) return new RetryableError(msg);
  return e instanceof Error ? e : new Error(msg);
}

function statusFromMsg(msg: string): number {
  const m = msg.match(/http (\d{3})/);
  return m ? Number(m[1]) : 0;
}
