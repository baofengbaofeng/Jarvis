import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { MAIN_DEFAULT, MAIN_MAX, MAIN_MIN, useMainPaneChrome } from './useMainPaneChrome';

describe('useMainPaneChrome', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to 800px main width', () => {
    const { result } = renderHook(() => useMainPaneChrome());
    expect(result.current.width).toBe(MAIN_DEFAULT);
  });

  it('clamps resize within min/max', () => {
    const { result } = renderHook(() => useMainPaneChrome());
    const target = document.createElement('div');
    act(() => {
      result.current.onResizePointerDown({
        preventDefault() {},
        clientX: 100,
        pointerId: 1,
        currentTarget: {
          setPointerCapture() {},
          releasePointerCapture() {},
        },
      } as unknown as ReactPointerEvent<HTMLDivElement>);
    });
    act(() => {
      result.current.onResizePointerMove({
        clientX: 100 + 5000,
        currentTarget: target,
      } as unknown as ReactPointerEvent<HTMLDivElement>);
    });
    expect(result.current.width).toBe(MAIN_MAX);
    act(() => {
      result.current.onResizePointerDown({
        preventDefault() {},
        clientX: 100,
        pointerId: 2,
        currentTarget: {
          setPointerCapture() {},
          releasePointerCapture() {},
        },
      } as unknown as ReactPointerEvent<HTMLDivElement>);
    });
    act(() => {
      result.current.onResizePointerMove({
        clientX: 100 - 5000,
        currentTarget: target,
      } as unknown as ReactPointerEvent<HTMLDivElement>);
    });
    expect(result.current.width).toBe(MAIN_MIN);
  });
});
