import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { UsageTracker } from './UsageTracker';

// Self-contained table: does not depend on the migrations module, so the tracker
// is tested against exactly the shape it writes.
function fresh() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE token_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, session_id TEXT, agent_id TEXT, model_id TEXT,
    prompt_tokens INTEGER NOT NULL, completion_tokens INTEGER NOT NULL, total_tokens INTEGER NOT NULL,
    cost_estimate REAL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  return db;
}

describe('UsageTracker', () => {
  it('tracks a record and aggregates summary', () => {
    const db = fresh();
    const t = new UsageTracker(db);
    t.track({ agentId: 'a1', modelId: 'm1', promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    t.track({ agentId: 'a1', modelId: 'm1', promptTokens: 20, completionTokens: 10, totalTokens: 30 });
    expect(t.summary().total).toEqual({ promptTokens: 30, completionTokens: 15, totalTokens: 45, calls: 2 });
    expect(t.summary().byAgent[0].agentId).toBe('a1');
  });

  it('lists all records or filters by agentId', () => {
    const db = fresh();
    const t = new UsageTracker(db);
    t.track({ agentId: 'a1', modelId: 'm1', promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    t.track({ agentId: 'a2', modelId: 'm2', promptTokens: 2, completionTokens: 3, totalTokens: 5 });
    expect(t.list().length).toBe(2);
    const a1 = t.list('a1');
    expect(a1.length).toBe(1);
    expect(a1[0].agentId).toBe('a1');
    expect(a1[0].totalTokens).toBe(15);
    expect(t.list('nope').length).toBe(0);
  });

  it('persists the record to the table', () => {
    const db = fresh();
    const t = new UsageTracker(db);
    t.track({ taskId: 't1', sessionId: 's1', agentId: 'a1', modelId: 'm1', promptTokens: 10, completionTokens: 5, totalTokens: 15, costEstimate: 0.5 });
    const row = db.prepare('SELECT task_id, session_id, agent_id, model_id, prompt_tokens, completion_tokens, total_tokens, cost_estimate FROM token_usage').get() as { task_id: string; session_id: string; agent_id: string; model_id: string; prompt_tokens: number; completion_tokens: number; total_tokens: number; cost_estimate: number };
    expect(row).toEqual({ task_id: 't1', session_id: 's1', agent_id: 'a1', model_id: 'm1', prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost_estimate: 0.5 });
  });
});
