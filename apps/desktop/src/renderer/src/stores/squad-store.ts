import { create } from 'zustand';
import { IpcChannel } from '@jarvis/protocol';

// K5 (M6 Task 10): a single squad/agent event on the timeline. Main pushes
// these on 'squad:event' (bus subscription + task log); the renderer's
// TimelineView renders them in arrival order.
export interface SquadEvent { agent: string; ts: number; kind: string; detail: string }

// K5 (M6 Task 10): module-level squad event log. Capped at 200 so a
// long-lived session cannot grow unbounded (same cap the brief specifies).
let events: SquadEvent[] = [];
const listeners = new Set<(es: SquadEvent[]) => void>();
export function pushSquadEvent(e: SquadEvent): void {
  events = [...events, e].slice(-200);
  listeners.forEach(l => l(events));
}
export function subscribeSquadEvents(fn: (es: SquadEvent[]) => void): () => void {
  listeners.add(fn); return () => listeners.delete(fn);
}
// Test-only reset so specs start from an empty log (module-level state; a stale
// event from an earlier spec would otherwise bleed into the next TimelineView).
export function clearSquadEvents(): void {
  events = [];
  listeners.forEach(l => l(events));
}

// K5 (M6 Task 10): main pushes every squad/agent event on 'squad:event'.
// Subscriptions are installed by initIpcSubscriptions() from init-store.

export interface SquadReview {
  id: string;
  summary: string;
  members: Array<{ agent: string; result: string }>;
}

interface SquadState {
  // The squad currently sitting in_review (if any). The ApprovalPanel at the
  // app root renders from this; Task 10's squad view will drive it via start().
  review: SquadReview | null;
  setReview: (r: SquadReview | null) => void;
  // Starts a squad run through the IPC and, when it reaches in_review, records
  // the full summary/members detail the squad.start result carries.
  start: (input: { id: string; input: string }) => Promise<void>;
}

export const useSquadStore = create<SquadState>((set) => ({
  review: null,
  setReview: (r) => set({ review: r }),
  async start({ id, input }) {
    const res = (await window.jarvis.invoke(IpcChannel.squadStart, { id, input })) as {
      ok: boolean; result?: { status: string; summary: string; members: Array<{ agent: string; result: string }> };
    };
    if (res.ok && res.result?.status === 'in_review') {
      set({ review: { id, summary: res.result.summary, members: res.result.members } });
    }
  }
}));

// F15 (M6 Task 8): squad:status updates review state — see initIpcSubscriptions().
