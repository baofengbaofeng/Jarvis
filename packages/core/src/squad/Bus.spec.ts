import { describe, it, expect } from 'vitest';
import { MessageBus } from './Bus';

describe('MessageBus', () => {
  it('delivers posted messages to subscribers', () => {
    const bus = new MessageBus();
    const seen: string[] = [];
    bus.subscribe(m => seen.push(m.kind));
    bus.post({ kind: 'request', from: 'a', to: 'b', taskId: 't1', payload: {} });
    expect(seen).toEqual(['request']);
  });

  it('resolves request when a response arrives', async () => {
    const bus = new MessageBus();
    const p = bus.request({ kind: 'delegate', from: 'leader', to: 'member', taskId: 't1', payload: { subtask: 'x' } }, 1000);
    bus.post({ kind: 'response', from: 'member', to: 'leader', taskId: 't1', payload: { text: 'done' } });
    const r = await p;
    expect(r.payload).toEqual({ text: 'done' });
  });

  it('rejects when no response arrives in time', async () => {
    const bus = new MessageBus();
    await expect(bus.request({ kind: 'delegate', from: 'a', to: 'b', taskId: 't', payload: {} }, 5)).rejects.toThrow('timeout');
  });

  it('unsubscribes a listener', () => {
    const bus = new MessageBus();
    let n = 0;
    const off = bus.subscribe(() => n++);
    off();
    bus.post({ kind: 'log', from: 'a', to: '*', payload: {} });
    expect(n).toBe(0);
  });

  it('a throwing subscriber does not block other subscribers or response resolution', async () => {
    const bus = new MessageBus();
    const seen: string[] = [];
    bus.subscribe(() => { throw new Error('boom'); });
    bus.subscribe(m => seen.push(m.kind));
    const p = bus.request({ kind: 'delegate', from: 'a', to: 'b', taskId: 't', payload: {} }, 1000);
    bus.post({ kind: 'response', from: 'b', to: 'a', taskId: 't', payload: { ok: 1 } });
    const r = await p;
    expect(seen).toEqual(['delegate', 'response']);
    expect(r.payload).toEqual({ ok: 1 });
  });

  it('rejects a duplicate pending request from the same requester + taskId', async () => {
    const bus = new MessageBus();
    const p1 = bus.request({ kind: 'delegate', from: 'a', to: 'b', taskId: 't', payload: {} }, 1000);
    await expect(bus.request({ kind: 'delegate', from: 'a', to: 'b', taskId: 't', payload: {} }, 1000)).rejects.toThrow('duplicate');
    // The duplicate must not corrupt the first waiter: it still resolves.
    bus.post({ kind: 'response', from: 'b', to: 'a', taskId: 't', payload: { ok: 1 } });
    await expect(p1).resolves.toMatchObject({ payload: { ok: 1 } });
  });
});
