import { create } from 'zustand';

export type RuntimeMode = 'local' | 'runtime_registered' | 'runtime_busy';

export interface RuntimeStatus {
  registered: boolean;
  busy: boolean;
  activeTasks: number;
  lastHeartbeatAt: number;
  serverUrl: string;
  protocol: string;
  mode: RuntimeMode;
}

export function deriveMode(registered: boolean, busy: boolean): RuntimeMode {
  if (!registered) return 'local';
  return busy ? 'runtime_busy' : 'runtime_registered';
}

interface RuntimeStore {
  status: RuntimeStatus | null;
  refresh: () => Promise<void>;
}

export const useRuntimeStore = create<RuntimeStore>((set) => ({
  status: null,
  refresh: async () => {
    // Task 1 convention: an IPC rejection must not propagate as an unhandled
    // promise rejection from the polling callers (RuntimeStatusView polls every
    // 3s). Leave the last-known status in place on failure so the view degrades
    // gracefully instead of throwing mid-render.
    try {
      const s = (await window.jarvis.invoke('runtime.status')) as RuntimeStatus;
      set({ status: s });
    } catch (e) {
      console.error('runtime.status failed', e);
    }
  },
}));
