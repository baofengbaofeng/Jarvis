import { useCallback, useEffect, useState } from 'react';

const AGENTS_KEY = 'jarvis.pinned.agents';
const CHATS_KEY = 'jarvis.pinned.chats';

function readIds(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export type PinKind = 'agent' | 'chat';

export function usePinnedItems() {
  const [pinnedAgents, setPinnedAgents] = useState<string[]>(() => readIds(AGENTS_KEY));
  const [pinnedChats, setPinnedChats] = useState<string[]>(() => readIds(CHATS_KEY));

  useEffect(() => {
    try { localStorage.setItem(AGENTS_KEY, JSON.stringify(pinnedAgents)); } catch { /* ignore */ }
  }, [pinnedAgents]);

  useEffect(() => {
    try { localStorage.setItem(CHATS_KEY, JSON.stringify(pinnedChats)); } catch { /* ignore */ }
  }, [pinnedChats]);

  const isAgentPinned = useCallback(
    (id: string) => pinnedAgents.includes(id),
    [pinnedAgents],
  );

  const isChatPinned = useCallback(
    (id: string) => pinnedChats.includes(id),
    [pinnedChats],
  );

  const toggleAgentPin = useCallback((id: string) => {
    setPinnedAgents((prev) => toggleId(prev, id));
  }, []);

  const toggleChatPin = useCallback((id: string) => {
    setPinnedChats((prev) => toggleId(prev, id));
  }, []);

  const sortByPinned = useCallback(<T extends { id: string }>(
    items: T[],
    kind: PinKind,
  ): T[] => {
    const pinned = kind === 'agent' ? pinnedAgents : pinnedChats;
    return [...items].sort((a, b) => {
      const ai = pinned.indexOf(a.id);
      const bi = pinned.indexOf(b.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [pinnedAgents, pinnedChats]);

  return {
    pinnedAgents,
    pinnedChats,
    isAgentPinned,
    isChatPinned,
    toggleAgentPin,
    toggleChatPin,
    sortByPinned,
  };
}
