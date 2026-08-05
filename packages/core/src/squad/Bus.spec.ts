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
});
