import { create } from 'zustand';
import type { ChatMessage, ChatSession } from '@jarvis/protocol';

interface ChatState {
  sessionId: string | null;
  sessions: ChatSession[];
  messages: ChatMessage[];
  streaming: boolean;
  streamingText: string;
  init: () => Promise<void>;
  newSession: () => Promise<void>;
  loadSession: (sessionId: string) => Promise<void>;
  loadSessions: () => Promise<void>;
  send: (text: string) => Promise<void>;
  appendDelta: (delta: string) => void;
  finishStream: (error?: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessionId: null,
  sessions: [],
  messages: [],
  streaming: false,
  streamingText: '',

  async init() {
    await get().loadSessions();
    if (get().sessions.length > 0) await get().loadSession(get().sessions[0].id);
    else await get().newSession();
  },

  async loadSessions() {
    const sessions = (await window.jarvis.invoke('chat.listSessions')) as ChatSession[];
    set({ sessions });
  },

  async newSession() {
    const s = (await window.jarvis.invoke('chat.createSession')) as { id: string };
    set({ sessionId: s.id, messages: [], streaming: false, streamingText: '' });
    await get().loadSessions();
  },

  async loadSession(sessionId: string) {
    const msgs = (await window.jarvis.invoke('chat.loadMessages', sessionId)) as ChatMessage[];
    set({ sessionId, messages: msgs, streaming: false, streamingText: '' });
    await get().loadSessions();
  },

  async send(text: string) {
    const { sessionId } = get();
    if (!sessionId || get().streaming) return;
    const userMsg: ChatMessage = { id: crypto.randomUUID(), sessionId, role: 'user', content: text, createdAt: new Date().toISOString() };
    set({ streaming: true, streamingText: '', messages: [...get().messages, userMsg] });
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
    const { sessionId, chunk } = payload as { sessionId: string; chunk: { kind: string; delta?: string } };
    if (sessionId !== useChatStore.getState().sessionId) return;
    if (chunk.kind === 'delta') useChatStore.getState().appendDelta(chunk.delta ?? '');
  });
  window.jarvis.onDidReceive('chat:done', (p) => {
    const { sessionId, error } = p as { sessionId: string; error?: string };
    if (sessionId !== useChatStore.getState().sessionId) return;
    useChatStore.getState().finishStream(error);
  });
}
