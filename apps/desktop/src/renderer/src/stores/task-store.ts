import { create } from 'zustand';
import { IpcChannel } from '@jarvis/protocol';

interface TaskState {
  activeTaskId: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused' | null;
  logs: string[];
  createTask: (agentId: string, prompt: string, sessionId?: string) => Promise<string>;
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
  async createTask(agentId, prompt, sessionId) {
    const { id } = (await window.jarvis.invoke(IpcChannel.taskCreate, { agentId, prompt, sessionId })) as { id: string };
    set({ activeTaskId: id, status: 'queued', logs: [] });
    return id;
  },
  async cancel() { if (get().activeTaskId) await window.jarvis.invoke(IpcChannel.taskCancel, get().activeTaskId); },
  async pause() { if (get().activeTaskId) await window.jarvis.invoke(IpcChannel.taskPause, get().activeTaskId); },
  async resume() { if (get().activeTaskId) await window.jarvis.invoke(IpcChannel.taskResume, get().activeTaskId); },
  async retry() { if (get().activeTaskId) await window.jarvis.invoke(IpcChannel.taskRetry, get().activeTaskId); },
  setStatus(_id, status) { set({ status }); },
  appendLog(line) { set(s => ({ logs: [...s.logs, line] })); }
}));
