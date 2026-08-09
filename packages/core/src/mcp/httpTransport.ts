import type { McpTransport } from './transport';
import { parseSseChunk, type FetchLike } from './sseParse';

export interface StreamableHttpTransportOpts {
  url: string;
  headers?: Record<string, string>;
  fetchImpl?: FetchLike;
  /** Reserved for desktop TLS override; core uses fetchImpl as-is. */
  tlsVerify?: boolean;
  onError?: (err: Error) => void;
}

/**
 * MCP Streamable HTTP (2025-03-26+): POST JSON-RPC to one MCP endpoint;
 * response is application/json or text/event-stream carrying the result.
 * Optionally remembers Mcp-Session-Id from older servers.
 */
export function createStreamableHttpTransport(opts: StreamableHttpTransportOpts): McpTransport {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseHeaders = { ...(opts.headers ?? {}) };
  let sessionId: string | undefined;
  let closed = false;
  const messageHandlers: Array<(msg: Record<string, unknown>) => void> = [];
  const abort = new AbortController();

  const emit = (msg: Record<string, unknown>) => {
    for (const h of messageHandlers) {
      try { h(msg); } catch { /* ignore */ }
    }
  };

  const fail = (err: Error) => {
    try { opts.onError?.(err); } catch { /* ignore */ }
  };

  const emitFromSseText = async (text: string) => {
    parseSseChunk(text.endsWith('\n\n') ? text : `${text}\n\n`, ({ event, data }) => {
      if (event && event !== 'message') return;
      try {
        emit(JSON.parse(data) as Record<string, unknown>);
      } catch (e) {
        fail(e instanceof Error ? e : new Error(String(e)));
      }
    });
  };

  return {
    send(msg) {
      void (async () => {
        if (closed) return;
        try {
          const method = typeof msg.method === 'string' ? msg.method : '';
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            ...baseHeaders,
          };
          if (sessionId) headers['Mcp-Session-Id'] = sessionId;
          if (method) headers['Mcp-Method'] = method;

          const res = await fetchImpl(opts.url, {
            method: 'POST',
            headers,
            body: JSON.stringify(msg),
            signal: abort.signal,
          });
          const sid = res.headers.get('mcp-session-id');
          if (sid) sessionId = sid;
          if (!res.ok) throw new Error(`streamable-http ${res.status}`);
          const ct = res.headers.get('content-type') ?? '';
          if (ct.includes('text/event-stream')) {
            const text = await res.text();
            await emitFromSseText(text);
            return;
          }
          const body = await res.json() as Record<string, unknown>;
          emit(body);
        } catch (e) {
          if (!closed) fail(e instanceof Error ? e : new Error(String(e)));
        }
      })();
    },
    onMessage(cb) { messageHandlers.push(cb); },
    close() {
      closed = true;
      abort.abort();
    },
  };
}
