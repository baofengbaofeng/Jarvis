import { create } from 'zustand';
import type { Provider } from '@jarvis/protocol';
import { IpcChannel } from '@jarvis/protocol';

interface ProviderState {
  providers: Provider[];
  loading: boolean;
  refresh: () => Promise<void>;
  create: (input: { name: string; type: 'openai-compatible' | 'anthropic-compatible'; baseUrl: string; apiKey: string }) => Promise<Provider>;
  remove: (id: string) => Promise<void>;
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  providers: [],
  loading: false,
  async refresh() {
    set({ loading: true });
    const providers = (await window.jarvis.invoke(IpcChannel.providerList)) as Provider[];
    set({ providers, loading: false });
  },
  async create(input) {
    const p = (await window.jarvis.invoke(IpcChannel.providerCreate, input)) as Provider;
    set({ providers: [...get().providers, p] });
    return p;
  },
  async remove(id) {
    await window.jarvis.invoke(IpcChannel.providerDelete, id);
    set({ providers: get().providers.filter(p => p.id !== id) });
  }
}));
