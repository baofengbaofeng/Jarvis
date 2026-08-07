import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createStdioTransport } from './transport';

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  kill = () => { this.killed = true; };
}

describe('createStdioTransport (CORE-09)', () => {
  it('drains stderr so a noisy child cannot deadlock the pipe', async () => {
    const child = new FakeChild();
    const transport = createStdioTransport('cmd', [], () => child as unknown as import('node:child_process').ChildProcess);
    // Fill more than a typical pipe buffer; without a reader this would block.
    const chunk = Buffer.alloc(64 * 1024, 0x61);
    for (let i = 0; i < 4; i++) child.stderr.write(chunk);
    // Give the stderr reader a turn, then prove stdout still flows.
    await new Promise(r => setTimeout(r, 10));
    const messages: unknown[] = [];
    transport.onMessage((m) => messages.push(m));
    child.stdout.write('{"jsonrpc":"2.0","id":1,"result":{}}\n');
    await new Promise(r => setTimeout(r, 10));
    expect(messages).toEqual([{ jsonrpc: '2.0', id: 1, result: {} }]);
    transport.close();
  });

  it('handles child error without throwing out of the event emitter', () => {
    const child = new FakeChild();
    const onError = vi.fn();
    const transport = createStdioTransport('cmd', [], () => child as unknown as import('node:child_process').ChildProcess, { onError });
    expect(() => child.emit('error', new Error('spawn ENOENT'))).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0][0])).toContain('ENOENT');
    transport.close();
  });
});
