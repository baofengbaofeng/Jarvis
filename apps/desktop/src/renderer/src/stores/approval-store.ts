import { create } from 'zustand';
import { IpcChannel } from '@jarvis/protocol';

export interface ApprovalRequest {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  prompt: string;
}

interface ApprovalState {
  pending: ApprovalRequest[];
  resolve: (id: string, ok: boolean) => Promise<void>;
}

export const useApprovalStore = create<ApprovalState>((set) => ({
  pending: [],
  async resolve(id, ok) {
    await window.jarvis.invoke(IpcChannel.approvalResolve, id, ok);
    set((s) => ({ pending: s.pending.filter((p) => p.id !== id) }));
  }
}));
