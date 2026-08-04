import { create } from 'zustand';

interface TaskState {
  activeTaskId: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused' | null;
  logs: string[];
  createTask: (agentId: string, prompt: string) => Promise<string>;
  cancel: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  retry: () => Promise<void>;
  setStatus: (id: string, status: TaskState['status']) => void;
  appendLog: (line: string) => void;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  activeTaskId: null,
  status: null,
  logs: [],
  async createTask(agentId, prompt) {
    const { id } = (await window.jarvis.invoke('task.create', { agentId, prompt })) as { id: string };
    set({ activeTaskId: id, status: 'queued', logs: [] });
    return id;
  },
  async cancel() { if (get().activeTaskId) await window.jarvis.invoke('task.cancel', get().activeTaskId); },
  async pause() { if (get().activeTaskId) await window.jarvis.invoke('task.pause', get().activeTaskId); },
  async resume() { if (get().activeTaskId) await window.jarvis.invoke('task.resume', get().activeTaskId); },
  async retry() { if (get().activeTaskId) await window.jarvis.invoke('task.retry', get().activeTaskId); },
  setStatus(_id, status) { set({ status }); },
  appendLog(line) { set(s => ({ logs: [...s.logs, line] })); }
}));

if (typeof window !== 'undefined' && window.jarvis?.onDidReceive) {
  window.jarvis.onDidReceive('task:state', (p) => { const { id, state } = p as { id: string; state: TaskState['status'] }; useTaskStore.getState().setStatus(id, state); });
  window.jarvis.onDidReceive('task:log', (p) => { const { line } = p as { id: string; line: string }; useTaskStore.getState().appendLog(line); });
}
