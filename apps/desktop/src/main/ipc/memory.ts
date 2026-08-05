import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { MemoryEntry } from '@jarvis/core';

// F11 persistent agent memory: the main process owns the agent_memory table
// (see migration v8). The adapter is the DB boundary for the shared MemoryStore
// from @jarvis/core; it is keyed by agent_id so ONE adapter/store serves every
// agent — the MemoryStore methods take agentId as a parameter and the
// UNIQUE(agent_id, key) constraint keeps a single value per (agent, key) pair.

const rowToEntry = (r: Record<string, unknown>): MemoryEntry => ({
  id: r.id as string, agentId: r.agent_id as string, key: r.key as string,
  value: r.value as string, updatedAt: r.updated_at as string
});

export function createMemoryAdapter(db: Database.Database) {
  const now = () => new Date().toISOString();
  return {
    // Upsert via ON CONFLICT: a memorize overwrites the previous value AND its
    // timestamp in place (no row churn), which is what "persistent memory"
    // means for the F11 model — the last written value wins.
    upsert(agentId: string, key: string, value: string): void {
      db.prepare('INSERT INTO agent_memory (id, agent_id, key, value, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(agent_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
        .run(randomUUID(), agentId, key, value, now());
    },
    get(agentId: string, key: string): MemoryEntry | null {
      const r = db.prepare('SELECT id, agent_id, key, value, updated_at FROM agent_memory WHERE agent_id = ? AND key = ?').get(agentId, key) as Record<string, unknown> | undefined;
      return r ? rowToEntry(r) : null;
    },
    list(agentId: string): MemoryEntry[] {
      return (db.prepare('SELECT id, agent_id, key, value, updated_at FROM agent_memory WHERE agent_id = ? ORDER BY updated_at').all(agentId) as Record<string, unknown>[]).map(rowToEntry);
    },
    remove(agentId: string, key: string): void {
      db.prepare('DELETE FROM agent_memory WHERE agent_id = ? AND key = ?').run(agentId, key);
    }
  };
}
