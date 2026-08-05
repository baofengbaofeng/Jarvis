import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ToastHost } from './ToastHost';
import { toast, clearToasts, subscribeToasts, type Toast } from '../../stores/toast-store';

afterEach(() => {
  cleanup();
  // The store is module-level state; drop any leftover toasts so specs do not
  // bleed into each other.
  clearToasts();
});

describe('ToastHost', () => {
  it('renders an empty host by default', () => {
    render(<ToastHost />);
    expect(screen.getByTestId('toast-host')).toBeTruthy();
  });

  it('shows a toast pushed via the store', async () => {
    render(<ToastHost />);
    toast('success', 'Task complete');
    expect(await screen.findByTestId('toast-success')).toBeTruthy();
    expect(screen.getByTestId('toast-success').textContent).toContain('Task complete');
  });

  it('the store auto-removes a toast after the display window (store-level)', () => {
    vi.useFakeTimers();
    try {
      const seen: Toast[][] = [];
      const unsub = subscribeToasts((ts) => seen.push(ts));
      toast('info', 'x');
      expect(seen.at(-1)).toHaveLength(1);
      vi.advanceTimersByTime(4000);
      expect(seen.at(-1)).toHaveLength(0);
      unsub();
    } finally {
      vi.useRealTimers();
    }
  });
});
