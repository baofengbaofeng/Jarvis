import { create } from 'zustand';
import type { ChatMessage } from '@jarvis/protocol';

interface ChatState {
  sessionId: string | null;
  messages: ChatMessage[];
  streaming: boolean;
  streamingText: string;
  init: () => Promise<void>;
  newSession: () => Promise<void>;
  loadSession: (sessionId: string) => Promise<void>;
  send: (text: string) => Promise<void>;
  appendDelta: (delta: string) => void;
  finishStream: (error?: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessionId: null,
  messages: [],
  streaming: false,
  streamingText: '',

  async init() {
    const sessions = (await window.jarvis.invoke('chat.listSessions')) as Array<{ id: string }>;
    if (sessions.length > 0) await get().loadSession(sessions[0].id);
    else await get().newSession();
  },

  async newSession() {
    const s = (await window.jarvis.invoke('chat.createSession')) as { id: string };
    set({ sessionId: s.id, messages: [], streamingText: '' });
  },

  async loadSession(sessionId: string) {
    const msgs = (await window.jarvis.invoke('chat.loadMessages', sessionId)) as ChatMessage[];
    set({ sessionId, messages: msgs, streamingText: '' });
  },

  async send(text: string) {
    const { sessionId } = get();
    if (!sessionId || get().streaming) return;
    set({ streaming: true, streamingText: '' });
    try {
      await window.jarvis.invoke('chat.send', { sessionId, text, agentId: 'placeholder-agent' });
    } catch (e) { get().finishStream(e instanceof Error ? e.message : String(e)); }
  },

  appendDelta(delta: string) { set((s) => ({ streamingText: s.streamingText + delta })); },

  finishStream(error?: string) {
    set((s) => {
      const finalText = error ?? s.streamingText;
      const msg: ChatMessage = { id: crypto.randomUUID(), sessionId: s.sessionId!, role: 'assistant', content: finalText, createdAt: new Date().toISOString() };
      return { streaming: false, streamingText: '', messages: [...s.messages, msg] };
    });
  }
}));

if (typeof window !== 'undefined' && window.jarvis?.onDidReceive) {
  window.jarvis.onDidReceive('chat:delta', (payload) => {
    const { chunk } = payload as { sessionId: string; chunk: { kind: string; delta?: string } };
    if (chunk.kind === 'delta') useChatStore.getState().appendDelta(chunk.delta ?? '');
  });
  window.jarvis.onDidReceive('chat:done', (p) => useChatStore.getState().finishStream((p as { error?: string }).error));
}
