import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT, SIDEBAR_MIN, useSidebarChrome } from './useSidebarChrome';

describe('useSidebarChrome', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to expanded default width', () => {
    const { result } = renderHook(() => useSidebarChrome());
    expect(result.current.collapsed).toBe(false);
    expect(result.current.effectiveWidth).toBe(SIDEBAR_DEFAULT);
  });

  it('toggles collapse and fully hides the menu column (width 0)', () => {
    const { result } = renderHook(() => useSidebarChrome());
    act(() => { result.current.toggleCollapsed(); });
    expect(result.current.collapsed).toBe(true);
    expect(SIDEBAR_COLLAPSED).toBe(0);
    expect(result.current.effectiveWidth).toBe(0);
    expect(localStorage.getItem('jarvis.sidebar.collapsed')).toBe('1');
  });

  it('clamps resize within min/max', () => {
    const { result } = renderHook(() => useSidebarChrome());
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
        clientX: 100 - 1000,
        currentTarget: target,
      } as unknown as ReactPointerEvent<HTMLDivElement>);
    });
    expect(result.current.width).toBe(SIDEBAR_MIN);
  });
});
