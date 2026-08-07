import { create } from 'zustand';
import type { ChatMessage, ChatSession } from '@jarvis/protocol';
import { IpcChannel } from '@jarvis/protocol';
import { toContentArray } from '@jarvis/core/renderer';
import type { StepCardStatus } from '@jarvis/ui';
import { useAgentStore } from './agent-store';
import { useTaskStore } from './task-store';

export type ChatStep = {
  id: string;
  title: string;
  status: StepCardStatus;
  detail?: string;
};

interface ChatState {
  sessionId: string | null;
  sessions: ChatSession[];
  messages: ChatMessage[];
  steps: ChatStep[];
  streaming: boolean;
  streamingText: string;
  streamingTaskSessionId: string | null;
  pendingImages: string[];
  addImages: (urls: string[]) => void;
  removeImage: (url: string) => void;
  upsertStep: (step: ChatStep) => void;
  clearSteps: () => void;
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
  steps: [],
  streaming: false,
  streamingText: '',
  streamingTaskSessionId: null,
  pendingImages: [],
  addImages(urls) { set(s => ({ pendingImages: [...s.pendingImages, ...urls.filter(u => !s.pendingImages.includes(u))] })); },
  removeImage(url) { set(s => ({ pendingImages: s.pendingImages.filter(u => u !== url) })); },
  upsertStep(step) {
    set((s) => {
      const idx = s.steps.findIndex((x) => x.id === step.id);
      const steps = [...s.steps];
      if (idx >= 0) steps[idx] = step;
      else steps.push(step);
      return { steps };
    });
  },
  clearSteps() { set({ steps: [] }); },

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
    set({ sessionId: s.id, messages: [], steps: [], streaming: false, streamingText: '', streamingTaskSessionId: null });
    await get().loadSessions();
  },

  async loadSession(sessionId: string) {
    const msgs = (await window.jarvis.invoke(IpcChannel.chatLoadMessages, sessionId)) as ChatMessage[];
    set({ sessionId, messages: msgs, steps: [], streaming: false, streamingText: '', streamingTaskSessionId: null });
    await get().loadSessions();
  },

  async send(text: string) {
    const { sessionId, pendingImages } = get();
    if (!sessionId || get().streaming) return;
    const agentId = useAgentStore.getState().current?.id;
    if (!agentId) return;
    const content = pendingImages.length ? toContentArray(text, pendingImages) : text;
    const userMsg: ChatMessage = { id: crypto.randomUUID(), sessionId, role: 'user', content, createdAt: new Date().toISOString() };
    set({ streaming: true, streamingText: '', steps: [], streamingTaskSessionId: sessionId, messages: [...get().messages, userMsg] });
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
      return { streaming: false, streamingText: '', streamingTaskSessionId: null, steps: [], messages: [...s.messages, msg] };
    });
  }
}));
