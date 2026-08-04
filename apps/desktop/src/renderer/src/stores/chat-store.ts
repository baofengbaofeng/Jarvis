import { create } from 'zustand';
import type { ChatMessage, ChatSession, TaskStatus } from '@jarvis/protocol';
import { useAgentStore } from './agent-store';
import { useTaskStore } from './task-store';

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
  finishStream: (text?: string, error?: string) => void;
}

// The chat session that launched the currently-streaming task. Guarded by
// send()'s `streaming` flag so only one task is in flight at a time.
let taskSessionId: string | null = null;

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
    const agentId = useAgentStore.getState().current?.id;
    if (!agentId) return; // 无选中 Agent 时不发起任务
    const userMsg: ChatMessage = { id: crypto.randomUUID(), sessionId, role: 'user', content: text, createdAt: new Date().toISOString() };
    set({ streaming: true, streamingText: '', messages: [...get().messages, userMsg] });
    taskSessionId = sessionId;
    try {
      // M2: route the UI chat through the task execution path. The assistant
      // reply streams back through task:log / task:complete / task:failed.
      await useTaskStore.getState().createTask(agentId, text, sessionId);
    } catch (e) {
      taskSessionId = null;
      get().finishStream(undefined, e instanceof Error ? e.message : String(e));
    }
  },

  appendDelta(delta: string) { set((s) => ({ streamingText: s.streamingText + delta })); },

  finishStream(text?: string, error?: string) {
    set((s) => {
      const finalText = error ?? text ?? s.streamingText;
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
  // chat:done is retained for backward compatibility with the M1 chat.send path.
  window.jarvis.onDidReceive('chat:done', (p) => {
    const { sessionId, error } = p as { sessionId: string; error?: string };
    if (sessionId !== useChatStore.getState().sessionId) return;
    useChatStore.getState().finishStream(undefined, error);
  });

  // M2 task path: feed streamed deltas into the live bubble and finalize it
  // when the task terminates.
  window.jarvis.onDidReceive('task:log', (p) => {
    const { id, line } = p as { id: string; line: string };
    if (id !== useTaskStore.getState().activeTaskId) return;
    if (taskSessionId !== useChatStore.getState().sessionId) return;
    useChatStore.getState().appendDelta(line);
  });
  window.jarvis.onDidReceive('task:complete', (p) => {
    const { id, text } = p as { id: string; text: string };
    if (id !== useTaskStore.getState().activeTaskId) return;
    if (taskSessionId !== useChatStore.getState().sessionId) return;
    useChatStore.getState().finishStream(text);
  });
  window.jarvis.onDidReceive('task:failed', (p) => {
    const { id, text } = p as { id: string; text: string };
    if (id !== useTaskStore.getState().activeTaskId) return;
    if (taskSessionId !== useChatStore.getState().sessionId) return;
    useChatStore.getState().finishStream(undefined, text);
  });
  // A cancelled task never fires task:complete/failed, so finalize the stream
  // here so the UI does not stay stuck in the streaming state.
  window.jarvis.onDidReceive('task:state', (p) => {
    const { id, state } = p as { id: string; state: TaskStatus };
    if (id !== useTaskStore.getState().activeTaskId) return;
    if (taskSessionId !== useChatStore.getState().sessionId) return;
    if (state === 'cancelled') useChatStore.getState().finishStream(undefined, 'task cancelled');
  });
}
