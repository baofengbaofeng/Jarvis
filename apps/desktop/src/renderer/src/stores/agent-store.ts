import { create } from 'zustand';
import type { AgentConfig } from '@jarvis/protocol';
import { IpcChannel } from '@jarvis/protocol';

interface AgentState {
  agents: AgentConfig[];
  current: AgentConfig | null;
  refresh: () => Promise<void>;
  create: (input: { name: string; systemPrompt: string; modelId: string | null; workspaceId: string | null }) => Promise<AgentConfig>;
  update: (id: string, patch: Partial<{ name: string; systemPrompt: string; modelId: string | null; workspaceId: string | null }>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setCurrent: (a: AgentConfig) => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  current: null,
  async refresh() {
    const agents = (await window.jarvis.invoke(IpcChannel.agentList)) as AgentConfig[];
    const current = get().current;
    // Drop a deleted agent from `current` so chat sends never target a dead id.
    const stillExists = current ? agents.some(a => a.id === current.id) : false;
    set({ agents, current: stillExists ? current : (agents[0] ?? null) });
  },
  async create(input) {
    const a = (await window.jarvis.invoke(IpcChannel.agentCreate, input)) as AgentConfig;
    set({ agents: [...get().agents, a], current: get().current ?? a });
    return a;
  },
  async update(id, patch) {
    await window.jarvis.invoke(IpcChannel.agentUpdate, id, patch);
    await get().refresh();
  },
  async remove(id) {
    await window.jarvis.invoke(IpcChannel.agentDelete, id);
    await get().refresh();
  },
  setCurrent(a) { set({ current: a }); }
}));
