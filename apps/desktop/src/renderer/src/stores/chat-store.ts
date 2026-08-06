import { create } from 'zustand';
import type { ChatMessage, ChatSession } from '@jarvis/protocol';
import { IpcChannel } from '@jarvis/protocol';
import { toContentArray } from '@jarvis/core/renderer';
import { useAgentStore } from './agent-store';
import { useTaskStore } from './task-store';

interface ChatState {
  sessionId: string | null;
  sessions: ChatSession[];
  messages: ChatMessage[];
  streaming: boolean;
  streamingText: string;
  /** Session that launched the in-flight task stream (guarded by `streaming`). */
  streamingTaskSessionId: string | null;
  pendingImages: string[];
  addImages: (urls: string[]) => void;
  removeImage: (url: string) => void;
  init: () => Promise<void>;
  newSession: () => Promise<void>;
  loadSession: (sessionId: string) => Promise<void>;
  loadSessions: () => Promise<void>;
  send: (text: string) => Promise<void>;
  appendDelta: (delta: string) => void;
  finishStream: (text?: string, error?: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessionId: null,
  sessions: [],
  messages: [],
  streaming: false,
  streamingText: '',
  streamingTaskSessionId: null,
  pendingImages: [],
  addImages(urls) { set(s => ({ pendingImages: [...s.pendingImages, ...urls.filter(u => !s.pendingImages.includes(u))] })); },
  removeImage(url) { set(s => ({ pendingImages: s.pendingImages.filter(u => u !== url) })); },

  async init() {
    await get().loadSessions();
    if (get().sessions.length > 0) await get().loadSession(get().sessions[0].id);
    else await get().newSession();
  },

  async loadSessions() {
    const sessions = (await window.jarvis.invoke(IpcChannel.chatListSessions)) as ChatSession[];
    set({ sessions });
  },

  async newSession() {
    const s = (await window.jarvis.invoke(IpcChannel.chatCreateSession)) as { id: string };
    set({ sessionId: s.id, messages: [], streaming: false, streamingText: '', streamingTaskSessionId: null });
    await get().loadSessions();
  },

  async loadSession(sessionId: string) {
    const msgs = (await window.jarvis.invoke(IpcChannel.chatLoadMessages, sessionId)) as ChatMessage[];
    set({ sessionId, messages: msgs, streaming: false, streamingText: '', streamingTaskSessionId: null });
    await get().loadSessions();
  },

  async send(text: string) {
    const { sessionId, pendingImages } = get();
    if (!sessionId || get().streaming) return;
    const agentId = useAgentStore.getState().current?.id;
    if (!agentId) return;
    const content = pendingImages.length ? toContentArray(text, pendingImages) : text;
    const userMsg: ChatMessage = { id: crypto.randomUUID(), sessionId, role: 'user', content, createdAt: new Date().toISOString() };
    set({ streaming: true, streamingText: '', streamingTaskSessionId: sessionId, messages: [...get().messages, userMsg] });
    try {
      if (typeof content === 'string') {
        await useTaskStore.getState().createTask(agentId, content, sessionId);
      } else {
        await window.jarvis.invoke(IpcChannel.chatSend, { sessionId, agentId, content });
      }
      set({ pendingImages: [] });
    } catch (e) {
      set({ streamingTaskSessionId: null });
      get().finishStream(undefined, e instanceof Error ? e.message : String(e));
    }
  },

  appendDelta(delta: string) { set((s) => ({ streamingText: s.streamingText + delta })); },

  finishStream(text?: string, error?: string) {
    set((s) => {
      const finalText = error ?? text ?? s.streamingText;
      const msg: ChatMessage = { id: crypto.randomUUID(), sessionId: s.sessionId!, role: 'assistant', content: finalText, createdAt: new Date().toISOString() };
      return { streaming: false, streamingText: '', streamingTaskSessionId: null, messages: [...s.messages, msg] };
    });
  }
}));
