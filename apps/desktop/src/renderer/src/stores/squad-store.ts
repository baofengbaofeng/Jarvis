import { create } from 'zustand';
import { IpcEvent } from '@jarvis/protocol';

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
// Module-level guard matches toast-store/task-store so the subscription only
// installs in the real preload bridge (specs without window.jarvis skip it).
if (typeof window !== 'undefined' && window.jarvis?.onDidReceive) {
  window.jarvis.onDidReceive(IpcEvent.squadEvent, (payload) => {
    pushSquadEvent(payload as SquadEvent);
  });
}

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
    const res = (await window.jarvis.invoke('squad.start', { id, input })) as {
      ok: boolean; result?: { status: string; summary: string; members: Array<{ agent: string; result: string }> };
    };
    if (res.ok && res.result?.status === 'in_review') {
      set({ review: { id, summary: res.result.summary, members: res.result.members } });
    }
  }
}));

// F15 (M6 Task 8): a squad reaching in_review shows the ApprovalPanel; leaving
// it (approve → completed, reject → in_progress, cancel/fail) clears it. The
// squad:status event only carries { id, state }, so when it arrives WITHOUT a
// start() through this store the summary/members are left EMPTY — the
// ApprovalPanel then renders a clean "pending approval" state (title + buttons)
// instead of showing the raw squad UUID, and the squad.start invoke result
// remains the richer source when Task 10's squad view drives start().
if (typeof window !== 'undefined' && window.jarvis?.onDidReceive) {
  window.jarvis.onDidReceive('squad:status', (payload) => {
    const { id, state } = payload as { id: string; state: string };
    const cur = useSquadStore.getState().review;
    if (state === 'in_review') {
      // Don't clobber a start()-provided review that already carries the full
      // detail for this id; only seed when the event is the first signal.
      if (!cur || cur.id !== id) useSquadStore.setState({ review: { id, summary: '', members: [] } });
    } else if (cur?.id === id) {
      useSquadStore.setState({ review: null });
    }
  });
}
