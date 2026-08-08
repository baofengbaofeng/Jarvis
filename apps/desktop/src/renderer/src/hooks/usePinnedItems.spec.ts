import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePinnedItems } from './usePinnedItems';

describe('usePinnedItems', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('pins and unpins agents and chats', () => {
    const { result } = renderHook(() => usePinnedItems());
    expect(result.current.isAgentPinned('a1')).toBe(false);
    act(() => { result.current.toggleAgentPin('a1'); });
    expect(result.current.isAgentPinned('a1')).toBe(true);
    expect(localStorage.getItem('jarvis.pinned.agents')).toContain('a1');
    act(() => { result.current.toggleAgentPin('a1'); });
    expect(result.current.isAgentPinned('a1')).toBe(false);

    act(() => { result.current.toggleChatPin('s1'); });
    expect(result.current.isChatPinned('s1')).toBe(true);
    act(() => { result.current.toggleChatPin('s1'); });
    expect(result.current.isChatPinned('s1')).toBe(false);
  });

  it('sorts pinned items ahead of others and keeps pin order', () => {
    const { result } = renderHook(() => usePinnedItems());
    act(() => {
      result.current.toggleAgentPin('a2');
      result.current.toggleAgentPin('a3');
    });
    const sorted = result.current.sortByPinned(
      [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }, { id: 'a4' }],
      'agent',
    );
    expect(sorted.map((x) => x.id)).toEqual(['a2', 'a3', 'a1', 'a4']);
  });
});
