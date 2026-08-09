import type { McpTransport } from './transport';
import { parseSseChunk, type FetchLike } from './sseParse';

export interface SseTransportOpts {
  url: string;
  headers?: Record<string, string>;
  fetchImpl?: FetchLike;
  onError?: (err: Error) => void;
}

/**
 * MCP HTTP+SSE transport (protocol 2024-11-05): GET SSE until `endpoint` event,
 * then POST JSON-RPC to that message URL; inbound replies arrive as SSE `message`.
 */
export function createSseTransport(opts: SseTransportOpts): McpTransport {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers = { ...(opts.headers ?? {}) };
  let closed = false;
  let messageUrl: string | null = null;
  const ready: Array<() => void> = [];
  const messageHandlers: Array<(msg: Record<string, unknown>) => void> = [];
  const abort = new AbortController();

  const notifyReady = () => {
    while (ready.length) ready.shift()?.();
  };

  const waitReady = () => new Promise<void>((resolve, reject) => {
    if (closed) {
      reject(new Error('sse transport closed'));
      return;
    }
    if (messageUrl) {
      resolve();
      return;
    }
    ready.push(resolve);
  });

  const emit = (msg: Record<string, unknown>) => {
    for (const h of messageHandlers) {
      try { h(msg); } catch { /* ignore */ }
    }
  };

  const fail = (err: Error) => {
    try { opts.onError?.(err); } catch { /* ignore */ }
  };

  void (async () => {
    try {
      const res = await fetchImpl(opts.url, {
        method: 'GET',
        headers: { Accept: 'text/event-stream', ...headers },
        signal: abort.signal,
      });
      if (!res.ok || !res.body) throw new Error(`sse connect http ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (!closed) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        buf = parseSseChunk(buf, ({ event, data }) => {
          if (event === 'endpoint') {
            messageUrl = new URL(data, opts.url).href;
            notifyReady();
            return;
          }
          if (event === 'message' || event === '') {
            try {
              emit(JSON.parse(data) as Record<string, unknown>);
            } catch (e) {
              fail(e instanceof Error ? e : new Error(String(e)));
            }
          }
        });
      }
    } catch (e) {
      if (!closed) fail(e instanceof Error ? e : new Error(String(e)));
    }
  })();

  return {
    send(msg) {
      void (async () => {
        try {
          await waitReady();
          if (!messageUrl) throw new Error('sse endpoint missing');
          const res = await fetchImpl(messageUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
            body: JSON.stringify(msg),
            signal: abort.signal,
          });
          if (!res.ok) throw new Error(`sse post http ${res.status}`);
          // Some servers return the JSON-RPC result on the POST response.
          const ct = res.headers.get('content-type') ?? '';
          if (ct.includes('application/json')) {
            const body = await res.json() as Record<string, unknown>;
            if (body && typeof body === 'object') emit(body);
          }
        } catch (e) {
          if (!closed) fail(e instanceof Error ? e : new Error(String(e)));
        }
      })();
    },
    onMessage(cb) { messageHandlers.push(cb); },
    close() {
      closed = true;
      abort.abort();
      notifyReady();
    },
  };
}
