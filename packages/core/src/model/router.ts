import type { ChatRequest, ChatChunk, ProviderAdapter, Usage } from './types';
import { createAdapter, type CreateAdapterDeps } from './adapters/index';

export class RetryableError extends Error {}
export class TimeoutError extends Error {}

export interface ProviderPolicy { timeoutMs: number; maxRetries: number; circuitBreaker: boolean }

export interface RouterDeps {
  createAdapter?: (type: ChatRequest['provider']['type'], deps?: CreateAdapterDeps) => ProviderAdapter;
  /** CORE-17: delay before retry attempt N (0-based after first failure). Default: exp backoff + jitter. */
  backoffMs?: (attempt: number) => number;
  /** CORE-17: failures before opening the circuit (default 5). */
  circuitFailureThreshold?: number;
  /** CORE-17: ms to wait in open before a half-open probe (default 30_000). */
  circuitCooldownMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

export interface RouterChatOpts {
  apiKeyResolver: (ref: string) => Promise<string | null>;
  policy?: ProviderPolicy;
  onChunk?: (c: ChatChunk) => void;
  fallbackModelIds?: string[];
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_POLICY: ProviderPolicy = { timeoutMs: 60_000, maxRetries: 2, circuitBreaker: false };

type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitEntry {
  state: CircuitState;
  failures: number;
  openedAt: number;
}

export class ModelRouter {
  private circuits = new Map<string, CircuitEntry>();
  private deps: RouterDeps;
  private now: () => number;
  private failureThreshold: number;
  private cooldownMs: number;
  private backoffMs: (attempt: number) => number;

  constructor(deps: RouterDeps = {}) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
    this.failureThreshold = deps.circuitFailureThreshold ?? 5;
    this.cooldownMs = deps.circuitCooldownMs ?? 30_000;
    this.backoffMs = deps.backoffMs ?? defaultBackoffMs;
  }

  async chat(req: ChatRequest, opts: RouterChatOpts): Promise<{ text: string; usage: Usage | null }> {
    const policy = { ...DEFAULT_POLICY, ...opts.policy };
    this.assertCircuitAllows(req.provider.id, policy.circuitBreaker);
    // Resolve the API key before creating an adapter: interleaved chat() calls
    // must never read a shared adapter field after an await.
    const apiKey = await opts.apiKeyResolver(req.provider.apiKeyRef);
    if (!apiKey) throw new Error(`missing api key for provider ${req.provider.name}`);
    const models = [req.modelId, ...(opts.fallbackModelIds ?? [])];
    let lastError: Error | null = null;
    for (const modelId of models) {
      for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
        if (attempt > 0) {
          const delay = this.backoffMs(attempt - 1);
          if (delay > 0) await sleep(delay);
        }
        // Re-check circuit before each attempt (may have opened mid-loop).
        this.assertCircuitAllows(req.provider.id, policy.circuitBreaker);
        const adapter = (this.deps.createAdapter ?? createAdapter)(req.provider.type);
        try {
          // CORE-17: buffer chunks during the attempt; flush only on success so
          // a retry never duplicates deltas already shown to the caller.
          const buffered: ChatChunk[] = [];
          const text = await this.runOnce(adapter, { ...req, modelId }, apiKey, policy, (c) => buffered.push(c));
          for (const c of buffered) opts.onChunk?.(c);
          this.recordSuccess(req.provider.id);
          return text;
        } catch (e) {
          lastError = e as Error;
          if (e instanceof RetryableError || e instanceof TimeoutError) {
            this.recordFailure(req.provider.id, policy.circuitBreaker);
            continue;
          }
          break;
        }
      }
    }
    throw lastError ?? new Error('chat failed');
  }

  private assertCircuitAllows(providerId: string, enabled: boolean): void {
    if (!enabled) return;
    const entry = this.circuits.get(providerId);
    if (!entry || entry.state === 'closed') return;
    if (entry.state === 'open') {
      if (this.now() - entry.openedAt < this.cooldownMs) {
        throw new Error('circuit open');
      }
      // Cooldown elapsed → half-open: allow one probe.
      entry.state = 'half-open';
      return;
    }
    // half-open: only one in-flight probe is allowed; concurrent callers see open.
    // We keep half-open until success/failure records transition it.
  }

  private recordSuccess(providerId: string): void {
    this.circuits.delete(providerId);
  }

  private recordFailure(providerId: string, enabled: boolean): void {
    if (!enabled) return;
    const entry = this.circuits.get(providerId) ?? { state: 'closed' as CircuitState, failures: 0, openedAt: 0 };
    if (entry.state === 'half-open') {
      entry.state = 'open';
      entry.openedAt = this.now();
      entry.failures = this.failureThreshold;
      this.circuits.set(providerId, entry);
      return;
    }
    entry.failures += 1;
    if (entry.failures >= this.failureThreshold) {
      entry.state = 'open';
      entry.openedAt = this.now();
    }
    this.circuits.set(providerId, entry);
  }

  private runOnce(
    adapter: ProviderAdapter,
    req: ChatRequest,
    apiKey: string,
    policy: ProviderPolicy,
    onChunk?: (c: ChatChunk) => void,
  ): Promise<{ text: string; usage: Usage | null }> {
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      // CORE-17: idle timeout — reset on every chunk; abort only when silent
      // for timeoutMs (not wall-clock for the whole response).
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (idleTimer) clearTimeout(idleTimer);
        controller.signal.removeEventListener('abort', onAbort);
        fn();
      };
      const onAbort = () => {
        finish(() => reject(new TimeoutError('timeout')));
      };
      controller.signal.addEventListener('abort', onAbort);
      const armIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => controller.abort(), policy.timeoutMs);
      };
      armIdle();
      let text = '';
      let usage: Usage | null = null;
      adapter.chat(req, {
        apiKey,
        signal: controller.signal,
        onChunk: (c) => {
          if (settled) return;
          armIdle();
          if (c.kind === 'delta') text += c.delta;
          else if (c.kind === 'usage') usage = c.usage;
          // CORE-03: tool-argument parse failures arrive as soft error chunks
          // alongside a tool_call marked with argumentsParseError. Forward them
          // to the caller; do not abort the stream (provider failures still
          // throw from adapter.chat and are classified below).
          onChunk?.(c);
        }
      }).then(() => {
        finish(() => resolve({ text, usage }));
      }).catch((e) => {
        finish(() => {
          if (controller.signal.aborted) reject(new TimeoutError('timeout'));
          else reject(e instanceof RetryableError ? e : classifyError(e));
        });
      });
    });
  }
}

function defaultBackoffMs(attempt: number): number {
  // Exponential backoff with full jitter: [0, base * 2^attempt], base=200ms, cap 8s.
  const base = Math.min(8_000, 200 * 2 ** attempt);
  return Math.floor(Math.random() * base);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
