import { describe, it, expect, vi } from 'vitest';
import { debounce } from './debounce';

describe('debounce', () => {
  it('fires only once after a burst of calls, with the trailing args', async () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const d = debounce(fn, 50);
      d(1);
      d(2);
      d(3);
      vi.advanceTimersByTime(49);
      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(2);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fires again after a fresh burst once the debounce window has passed', async () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const d = debounce(fn, 50);
      d('x');
      vi.advanceTimersByTime(50);
      expect(fn).toHaveBeenCalledTimes(1);
      d('y');
      vi.advanceTimersByTime(50);
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenLastCalledWith('y');
    } finally {
      vi.useRealTimers();
    }
  });
});
