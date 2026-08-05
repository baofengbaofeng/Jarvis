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
    const s = (await window.jarvis.invoke('runtime.status')) as RuntimeStatus;
    set({ status: s });
  },
}));
