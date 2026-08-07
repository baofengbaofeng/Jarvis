import { describe, it, expect, vi } from 'vitest';
import { parseSSE } from './sse';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(enc.encode(chunk));
      c.close();
    },
  });
}

describe('parseSSE (CORE-16)', () => {
  it('merges multi-line data fields into one event (blank-line delimited)', async () => {
    const body = streamOf([
      'event: msg\n',
      'data: line1\n',
      'data: line2\n',
      '\n',
      'data: solo\n',
      '\n',
    ]);
    const events: Array<{ name: string; data: string }> = [];
    const yielded: string[] = [];
    for await (const data of parseSSE(body, (name, d) => events.push({ name, data: d }))) {
      yielded.push(data);
    }
    expect(yielded).toEqual(['line1\nline2', 'solo']);
    expect(events).toEqual([
      { name: 'msg', data: 'line1\nline2' },
      { name: '', data: 'solo' },
    ]);
  });

  it('releases the reader when the consumer breaks early', async () => {
    let cancelCalls = 0;
    const releaseLock = vi.fn();
    const cancel = vi.fn(async () => { cancelCalls++; });
    const reader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('data: one\n\ndata: two\n\n') })
        .mockResolvedValue({ done: true, value: undefined }),
      releaseLock,
      cancel,
    };
    const body = {
      getReader: () => reader,
    } as unknown as ReadableStream<Uint8Array>;

    for await (const data of parseSSE(body)) {
      if (data === 'one') break;
    }

    // Generator cleanup must run: cancel and/or releaseLock so the stream is not leaked.
    expect(cancelCalls + releaseLock.mock.calls.length).toBeGreaterThan(0);
    expect(cancel.mock.calls.length + releaseLock.mock.calls.length).toBeGreaterThan(0);
  });

  it('strips a single leading space after data: per SSE spec', async () => {
    const body = streamOf(['data: hello\n', 'data:world\n', '\n']);
    const yielded: string[] = [];
    for await (const data of parseSSE(body)) yielded.push(data);
    expect(yielded).toEqual(['hello\nworld']);
  });

  it('flushes a trailing event when the stream ends without a blank line', async () => {
    const body = streamOf(['data: [DONE]']);
    const yielded: string[] = [];
    for await (const data of parseSSE(body)) yielded.push(data);
    expect(yielded).toEqual(['[DONE]']);
  });
});
