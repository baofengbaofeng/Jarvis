import { create } from 'zustand';

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
// start() through this store the summary falls back to the squad id and the
// member list stays empty — the squad.start invoke result is the richer source.
if (typeof window !== 'undefined' && window.jarvis?.onDidReceive) {
  window.jarvis.onDidReceive('squad:status', (payload) => {
    const { id, state } = payload as { id: string; state: string };
    const cur = useSquadStore.getState().review;
    if (state === 'in_review') {
      // Don't clobber a start()-provided review that already carries the full
      // detail for this id; only seed when the event is the first signal.
      if (!cur || cur.id !== id) useSquadStore.setState({ review: { id, summary: id, members: [] } });
    } else if (cur?.id === id) {
      useSquadStore.setState({ review: null });
    }
  });
}
