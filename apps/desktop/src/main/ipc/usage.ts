import type { UsageTracker } from '../usage/UsageTracker';
import type { UsageRecord } from '@jarvis/core';

// M8 Task 2 (B9): token usage IPC. `summary`/`list` are registered by the router
// ('usage.summary' / 'usage.list'); `track` is exposed for completeness but is
// not registered — the chat/task paths write usage directly through the tracker.
export function createUsageIpc(tracker: UsageTracker) {
  return {
    summary: () => tracker.summary(),
    list: (_e: unknown, agentId?: string) => tracker.list(agentId),
    track: (_e: unknown, r: UsageRecord) => { tracker.track(r); return { ok: true }; },
  };
}
