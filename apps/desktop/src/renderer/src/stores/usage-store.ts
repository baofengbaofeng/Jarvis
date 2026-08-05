import { create } from 'zustand';

// Compatible inline copy of the main-side UsageSummary type. Defined here (not
// imported from main/usage/UsageTracker) so this renderer-safe store never pulls
// the full @jarvis/core barrel (node:* deps) or better-sqlite3 into the
// electron-vite renderer bundle.
export interface UsageTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  calls: number;
}
export interface UsageSummary {
  total: UsageTotals;
  byAgent: Array<{ agentId: string; usage: UsageTotals }>;
}

interface UsageStore {
  summary: UsageSummary | null;
  load: () => Promise<void>;
}

export const useUsageStore = create<UsageStore>((set) => ({
  summary: null,
  load: async () => {
    try {
      const s = (await window.jarvis.invoke('usage.summary')) as UsageSummary;
      set({ summary: s });
    } catch (e) {
      // Best-effort: keep the last-known summary on IPC failure instead of
      // throwing mid-render (same convention as runtime-store).
      console.error('usage.summary failed', e);
    }
  },
}));
