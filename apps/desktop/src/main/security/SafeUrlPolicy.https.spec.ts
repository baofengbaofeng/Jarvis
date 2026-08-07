import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { ClientRequest } from 'node:http';
import { describe, expect, it, vi, beforeEach, beforeAll } from 'vitest';

const httpsRequestMock = vi.fn();

vi.mock('node:https', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:https')>();
  return {
    ...actual,
    request: (...args: unknown[]) => httpsRequestMock(...args),
  };
});

type SafeUrlPolicyCtor = typeof import('./SafeUrlPolicy').SafeUrlPolicy;
let SafeUrlPolicy: SafeUrlPolicyCtor;

beforeAll(async () => {
  ({ SafeUrlPolicy } = await import('./SafeUrlPolicy'));
});

const PUBLIC_LOOKUP = async () => [{ address: '203.0.113.10', family: 4 as const }];
const LIMITS = { timeoutMs: 5_000, maxRedirects: 3, maxResponseBytes: 256 };

type MockIncoming = IncomingMessage & EventEmitter & { destroy: ReturnType<typeof vi.fn> };

function emitResponse(
  statusCode: number,
  opts: {
    headers?: Record<string, string>;
    body?: Buffer | ((incoming: MockIncoming) => void);
    delayMs?: number;
  } = {},
): void {
  httpsRequestMock.mockImplementationOnce((options, callback: (incoming: IncomingMessage) => void) => {
    const req = new EventEmitter() as ClientRequest & EventEmitter;
    req.write = vi.fn();
    req.end = vi.fn(function (this: ClientRequest & EventEmitter) {
      const run = () => {
        if (options.signal?.aborted) {
          req.emit('error', new Error('aborted'));
          return;
        }
        const incoming = new EventEmitter() as MockIncoming;
        incoming.statusCode = statusCode;
        incoming.statusMessage = String(statusCode);
        incoming.headers = opts.headers ?? {};
        incoming.destroy = vi.fn();
        callback(incoming);
        if (typeof opts.body === 'function') {
          opts.body(incoming);
        } else if (opts.body) {
          incoming.emit('data', opts.body);
          incoming.emit('end');
        } else {
          incoming.emit('end');
        }
      };
      if (opts.delayMs) setTimeout(run, opts.delayMs);
      else run();
      return this;
    }) as ClientRequest['end'];
    req.destroy = vi.fn();
    req.on = req.addListener.bind(req);
    return req;
  });
}

describe('SafeUrlPolicy (https.request path)', () => {
  beforeEach(() => {
    httpsRequestMock.mockReset();
  });

  it('returns a successful response body from https.request', async () => {
    emitResponse(200, { body: Buffer.from('hello') });
    const policy = new SafeUrlPolicy({ lookup: PUBLIC_LOOKUP });
    const res = await policy.request('https://public.example/', {}, LIMITS);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello');
    expect(httpsRequestMock).toHaveBeenCalledTimes(1);
  });

  it('throws URL_REDIRECT_LIMIT when redirects exceed maxRedirects', async () => {
    emitResponse(302, { headers: { location: 'https://public.example/next' } });
    emitResponse(302, { headers: { location: 'https://public.example/again' } });
    emitResponse(302, { headers: { location: 'https://public.example/final' } });
    emitResponse(302, { headers: { location: 'https://public.example/one-more' } });
    const policy = new SafeUrlPolicy({ lookup: PUBLIC_LOOKUP });
    await expect(policy.request('https://public.example/', {}, { ...LIMITS, maxRedirects: 2 }))
      .rejects.toThrow('URL_REDIRECT_LIMIT');
  });

  it('throws URL_REDIRECT_LIMIT when a redirect has no Location header', async () => {
    emitResponse(302, { headers: {} });
    const policy = new SafeUrlPolicy({ lookup: PUBLIC_LOOKUP });
    await expect(policy.request('https://public.example/', {}, { ...LIMITS, maxRedirects: 1 }))
      .rejects.toThrow('URL_REDIRECT_LIMIT');
  });

  it('throws URL_RESPONSE_TOO_LARGE when content-length exceeds the cap', async () => {
    emitResponse(200, { headers: { 'content-length': '9999' } });
    const policy = new SafeUrlPolicy({ lookup: PUBLIC_LOOKUP });
    await expect(policy.request('https://public.example/', {}, LIMITS))
      .rejects.toThrow('URL_RESPONSE_TOO_LARGE');
  });

  it('throws URL_RESPONSE_TOO_LARGE when streamed body exceeds the cap', async () => {
    emitResponse(200, {
      body: (incoming) => {
        incoming.emit('data', Buffer.alloc(200));
        incoming.emit('data', Buffer.alloc(100));
        incoming.emit('end');
      },
    });
    const policy = new SafeUrlPolicy({ lookup: PUBLIC_LOOKUP });
    await expect(policy.request('https://public.example/', {}, LIMITS))
      .rejects.toThrow('URL_RESPONSE_TOO_LARGE');
  });

  it('throws URL_TIMEOUT when the deadline elapses before the response completes', async () => {
    emitResponse(200, { delayMs: 200 });
    const policy = new SafeUrlPolicy({ lookup: PUBLIC_LOOKUP });
    await expect(policy.request('https://public.example/', {}, { ...LIMITS, timeoutMs: 30 }))
      .rejects.toThrow('URL_TIMEOUT');
  });

  it('throws URL_TIMEOUT when the socket errors after abort', async () => {
    httpsRequestMock.mockImplementationOnce((_options, _callback) => {
      const req = new EventEmitter() as ClientRequest & EventEmitter;
      req.write = vi.fn();
      req.end = vi.fn(function (this: ClientRequest & EventEmitter) {
        setTimeout(() => req.emit('error', new Error('ECONNRESET')), 50);
        return this;
      }) as ClientRequest['end'];
      req.destroy = vi.fn();
      req.on = req.addListener.bind(req);
      return req;
    });
    const policy = new SafeUrlPolicy({ lookup: PUBLIC_LOOKUP });
    await expect(policy.request('https://public.example/', {}, { ...LIMITS, timeoutMs: 10 }))
      .rejects.toThrow('URL_TIMEOUT');
  });

  it('uses the verified DNS address in the custom lookup without re-resolving', async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
    emitResponse(200, { body: Buffer.from('ok') });
    const policy = new SafeUrlPolicy({ lookup });
    await policy.request('https://public.example/', {}, LIMITS);
    expect(lookup).toHaveBeenCalledTimes(1);
    const options = httpsRequestMock.mock.calls[0]![0] as { lookup: (...a: unknown[]) => void };
    await new Promise<void>((resolve, reject) => {
      options.lookup('public.example', {}, (err: NodeJS.ErrnoException | null, address: string) => {
        try {
          expect(err).toBeNull();
          expect(address).toBe('203.0.113.10');
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });
});
