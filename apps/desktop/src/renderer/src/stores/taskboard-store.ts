import { create } from 'zustand';
import { groupByStatus, type TaskSummary, type BoardColumns } from '@jarvis/core/renderer';
import { IpcChannel } from '@jarvis/protocol';

const EMPTY: BoardColumns = { queued: [], running: [], paused: [], completed: [], failed: [], cancelled: [] };

export const useTaskboardStore = create<{
  cols: BoardColumns;
  loading: boolean;
  load: () => Promise<void>;
  cancel: (id: string) => Promise<void>;
  pause: (id: string) => Promise<void>;
  resume: (id: string) => Promise<void>;
  retry: (id: string) => Promise<void>;
}>((set, get) => ({
  cols: EMPTY,
  loading: false,
  load: async () => {
    set({ loading: true });
    const tasks = (await window.jarvis.invoke(IpcChannel.taskboardList)) as TaskSummary[];
    set({ cols: groupByStatus(tasks), loading: false });
  },
  cancel: async (id) => { await window.jarvis.invoke(IpcChannel.taskCancel, id); await get().load(); },
  pause: async (id) => { await window.jarvis.invoke(IpcChannel.taskPause, id); await get().load(); },
  resume: async (id) => { await window.jarvis.invoke(IpcChannel.taskResume, id); await get().load(); },
  retry: async (id) => { await window.jarvis.invoke(IpcChannel.taskRetry, id); await get().load(); },
}));
