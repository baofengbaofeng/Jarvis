import { create } from 'zustand';
import type { Provider } from '@jarvis/protocol';
import { IpcChannel } from '@jarvis/protocol';

type ProviderWriteInput = {
  name: string;
  type: 'openai-compatible' | 'anthropic-compatible';
  baseUrl: string;
  apiKey: string;
};

type ProviderUpdateInput = Partial<ProviderWriteInput>;

interface ProviderState {
  providers: Provider[];
  loading: boolean;
  refresh: () => Promise<void>;
  create: (input: ProviderWriteInput) => Promise<Provider>;
  update: (id: string, patch: ProviderUpdateInput) => Promise<Provider>;
  setEnabled: (id: string, enabled: boolean) => Promise<Provider>;
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
    const res = (await window.jarvis.invoke(IpcChannel.providerCreate, input)) as
      | { ok: true; provider: Provider }
      | { ok: false; error: string }
      | Provider;
    if (res && typeof res === 'object' && 'ok' in res) {
      if (!res.ok) throw new Error(res.error);
      set({ providers: [...get().providers, res.provider] });
      return res.provider;
    }
    // Legacy/mock shape: bare Provider
    const p = res as Provider;
    set({ providers: [...get().providers, p] });
    return p;
  },
  async update(id, patch) {
    const res = (await window.jarvis.invoke(IpcChannel.providerUpdate, id, patch)) as
      | { ok: true; provider: Provider }
      | { ok: false; error: string }
      | Provider;
    if (res && typeof res === 'object' && 'ok' in res) {
      if (!res.ok) throw new Error(res.error);
      set({ providers: get().providers.map((p) => (p.id === id ? res.provider : p)) });
      return res.provider;
    }
    const p = res as Provider;
    set({ providers: get().providers.map((row) => (row.id === id ? p : row)) });
    return p;
  },
  async setEnabled(id, enabled) {
    const res = (await window.jarvis.invoke('provider.setEnabled', id, enabled)) as
      | { ok: true; provider: Provider }
      | { ok: false; error: string };
    if (!res.ok) throw new Error(res.error);
    set({ providers: get().providers.map((p) => (p.id === id ? res.provider : p)) });
    return res.provider;
  },
  async remove(id) {
    const res = (await window.jarvis.invoke(IpcChannel.providerDelete, id)) as
      | { ok: true }
      | { ok: false; error: string }
      | void;
    if (res && typeof res === 'object' && 'ok' in res && !res.ok) {
      throw new Error(res.error);
    }
    set({ providers: get().providers.filter(p => p.id !== id) });
  }
}));
