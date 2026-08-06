import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import type { LookupAddress, LookupOptions } from 'node:dns';
import type { IncomingMessage } from 'node:http';
import { isRestrictedAddress, type SafeFetchLimits, type SafeHttpClient } from '@jarvis/core';

export interface SafeUrlPolicyOptions {
  allowLoopbackDev?: boolean;
  lookup?: (hostname: string) => Promise<LookupAddress[]>;
  fetchImpl?: typeof fetch;
}

interface VerifiedTarget {
  url: URL;
  addresses: LookupAddress[];
}

const DEFAULT_LIMITS: SafeFetchLimits = {
  timeoutMs: 15_000,
  maxRedirects: 3,
  maxResponseBytes: 5 * 1024 * 1024,
};

export class SafeUrlPolicy implements SafeHttpClient {
  private readonly allowLoopback: boolean;
  private readonly lookupFn: (hostname: string) => Promise<LookupAddress[]>;
  private readonly fetchImpl?: typeof fetch;

  constructor(opts: SafeUrlPolicyOptions = {}) {
    this.allowLoopback = opts.allowLoopbackDev ?? false;
    this.lookupFn = opts.lookup ?? ((host) => dnsLookup(host, { all: true, verbatim: true }));
    this.fetchImpl = opts.fetchImpl;
  }

  async assertAllowed(raw: string, signal?: AbortSignal): Promise<URL> {
    return (await this.verify(raw, signal)).url;
  }

  async request(url: string, init: RequestInit | undefined, limits: SafeFetchLimits): Promise<Response> {
    const merged = { ...DEFAULT_LIMITS, ...limits };
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    merged.signal?.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), merged.timeoutMs);

    try {
      let current = await this.verify(url, controller.signal);
      let redirects = 0;
      const method = init?.method ?? 'GET';
      const headers = headersToRecord(init?.headers);
      const body = init?.body ?? undefined;

      while (true) {
        const res = await this.dispatch(current, { method, headers, body }, merged, controller.signal);

        if (isRedirect(res.status)) {
          if (redirects >= merged.maxRedirects) throw new Error('URL_REDIRECT_LIMIT');
          const location = res.headers.get('location');
          if (!location) throw new Error('URL_REDIRECT_LIMIT');
          current = await this.verify(new URL(location, current.url).href, controller.signal);
          redirects++;
          continue;
        }

        return res;
      }
    } catch (e) {
      if (controller.signal.aborted && !(e instanceof Error && e.message.startsWith('URL_'))) {
        throw new Error('URL_TIMEOUT');
      }
      throw e;
    } finally {
      clearTimeout(timeout);
      merged.signal?.removeEventListener('abort', onAbort);
    }
  }

  private async verify(raw: string, signal?: AbortSignal): Promise<VerifiedTarget> {
    signal?.throwIfAborted();
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error('URL_HTTPS_REQUIRED');
    }
    if (url.protocol !== 'https:') throw new Error('URL_HTTPS_REQUIRED');
    if (url.username || url.password) throw new Error('URL_CREDENTIALS_FORBIDDEN');

    const addresses = await this.lookupFn(url.hostname);
    for (const entry of addresses) {
      if (isRestrictedAddress(entry.address, { allowLoopback: this.allowLoopback })) {
        throw new Error('URL_PRIVATE_ADDRESS');
      }
    }
    if (addresses.length === 0) throw new Error('URL_PRIVATE_ADDRESS');
    return { url, addresses };
  }

  private async dispatch(
    target: VerifiedTarget,
    reqInit: { method: string; headers: Record<string, string>; body?: BodyInit | null },
    limits: SafeFetchLimits,
    signal: AbortSignal,
  ): Promise<Response> {
    if (this.fetchImpl) {
      return this.fetchImpl(target.url.href, { ...reqInit, redirect: 'manual', signal });
    }

    return new Promise<Response>((resolve, reject) => {
      const { url, addresses } = target;
      let index = 0;
      const lookup = (
        _hostname: string,
        _options: LookupOptions | number,
        callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
      ) => {
        const entry = addresses[index++] ?? addresses[addresses.length - 1]!;
        callback(null, entry.address, entry.family);
      };

      const options: RequestOptions = {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: reqInit.method,
        headers: { ...reqInit.headers, Host: url.host },
        servername: url.hostname,
        lookup,
        signal,
      };

      const req = httpsRequest(options, (incoming) => {
        void readLimitedResponse(incoming, limits.maxResponseBytes)
          .then(({ body, truncated }) => {
            if (truncated) {
              req.destroy();
              reject(new Error('URL_RESPONSE_TOO_LARGE'));
              return;
            }
            const headers = new Headers();
            for (const [k, v] of Object.entries(incoming.headers)) {
              if (v === undefined) continue;
              if (Array.isArray(v)) v.forEach(item => headers.append(k, item));
              else headers.set(k, v);
            }
            resolve(new Response(body as unknown as BodyInit, { status: incoming.statusCode ?? 0, statusText: incoming.statusMessage ?? '', headers }));
          })
          .catch(reject);
      });

      req.on('error', (err) => {
        if (signal.aborted) reject(new Error('URL_TIMEOUT'));
        else reject(err);
      });

      if (reqInit.body != null) {
        if (typeof reqInit.body === 'string') req.write(reqInit.body);
        else reject(new Error('URL_HTTPS_REQUIRED'));
      }
      req.end();
    });
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function headersToRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((v, k) => { out[k] = v; });
    return out;
  }
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

async function readLimitedResponse(
  incoming: IncomingMessage,
  maxBytes: number,
): Promise<{ body: Uint8Array; truncated: boolean }> {
  const contentLength = incoming.headers['content-length'];
  if (contentLength !== undefined && Number(contentLength) > maxBytes) {
    incoming.destroy();
    return { body: new Uint8Array(), truncated: true };
  }

  const chunks: Buffer[] = [];
  let total = 0;
  return new Promise((resolve, reject) => {
    incoming.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        incoming.destroy();
        resolve({ body: new Uint8Array(), truncated: true });
        return;
      }
      chunks.push(chunk);
    });
    incoming.on('end', () => resolve({ body: new Uint8Array(Buffer.concat(chunks)), truncated: false }));
    incoming.on('error', reject);
  });
}

export function createDefaultSafeUrlPolicy(): SafeUrlPolicy {
  return new SafeUrlPolicy({
    allowLoopbackDev: process.env['JARVIS_ALLOW_LOOPBACK_URLS'] === '1',
  });
}

export const DEFAULT_SAFE_FETCH_LIMITS: SafeFetchLimits = DEFAULT_LIMITS;
