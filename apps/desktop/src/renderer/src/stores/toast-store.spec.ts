import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toast, subscribeToasts, clearToasts } from './toast-store';

describe('toast-store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearToasts();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pushes toasts to subscribers', () => {
    const spy = vi.fn();
    subscribeToasts(spy);
    toast('info', 'hello');
    expect(spy).toHaveBeenLastCalledWith([expect.objectContaining({ kind: 'info', message: 'hello' })]);
  });

  it('removes toast after timeout', () => {
    const spy = vi.fn();
    subscribeToasts(spy);
    toast('success', 'done');
    expect(spy.mock.calls.at(-1)?.[0]).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect(spy.mock.calls.at(-1)?.[0]).toHaveLength(0);
  });

  it('clearToasts resets queue', () => {
    const spy = vi.fn();
    subscribeToasts(spy);
    toast('error', 'fail');
    clearToasts();
    expect(spy).toHaveBeenLastCalledWith([]);
  });
});
