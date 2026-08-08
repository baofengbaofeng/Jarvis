import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { IpcChannel, IpcEvent } from '@jarvis/protocol';
import { useWindowChrome } from './useWindowChrome';

describe('useWindowChrome', () => {
  let handler: ((payload: unknown) => void) | null = null;
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    handler = null;
    invoke = vi.fn(async (channel: string) => {
      if (channel === IpcChannel.windowGetChrome) {
        return { fullscreen: false, titleInset: 80, trafficLight: { x: 14, y: 18 } };
      }
      return null;
    });
    (window as unknown as { jarvis: unknown }).jarvis = {
      invoke,
      onDidReceive: (channel: string, cb: (payload: unknown) => void) => {
        if (channel === IpcEvent.windowChrome) handler = cb;
        return () => { handler = null; };
      },
    };
  });

  it('loads windowed title inset on mount', async () => {
    const { result } = renderHook(() => useWindowChrome());
    await waitFor(() => expect(result.current.titleInset).toBe(80));
    expect(invoke).toHaveBeenCalledWith(IpcChannel.windowGetChrome);
  });

  it('switches to menu-icon inset on fullscreen', async () => {
    const { result } = renderHook(() => useWindowChrome());
    await waitFor(() => expect(result.current.titleInset).toBe(80));
    act(() => {
      handler?.({ fullscreen: true, titleInset: 16, trafficLight: { x: 0, y: 18 } });
    });
    expect(result.current.fullscreen).toBe(true);
    expect(result.current.titleInset).toBe(16);
  });
});
