import { create } from 'zustand';

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
    // approval.resolve is registered by IpcRouter and forwards to the main
    // process ApprovalCenter, which resolves the pending promise that the task
    // engine is awaiting. Clear the row locally so the modal disappears.
    await window.jarvis.invoke('approval.resolve', id, ok);
    set((s) => ({ pending: s.pending.filter((p) => p.id !== id) }));
  }
}));

// M3 final review (J2): the ApprovalCenter in main sends `approval:request` on
// every tool call that needs interactive approval (git_commit, first-time
// mcp:, sensitive run_shell). Previously no renderer component subscribed, so
// the promise never resolved and the task hung forever. Subscribe at module
// level (guarded like chat-store) so the modal store stays in sync.
if (typeof window !== 'undefined' && window.jarvis?.onDidReceive) {
  window.jarvis.onDidReceive('approval:request', (payload) => {
    const req = payload as ApprovalRequest;
    useApprovalStore.setState((s) => ({
      pending: s.pending.some((p) => p.id === req.id) ? s.pending : [...s.pending, req]
    }));
  });
}
