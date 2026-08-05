import type Database from 'better-sqlite3';
import { sumUsage, type UsageRecord, type Usage } from '@jarvis/core';

export interface UsageSummary {
  total: Usage & { calls: number };
  byAgent: Array<{ agentId: string; usage: Usage & { calls: number } }>;
}

// better-sqlite3 returns column names verbatim (snake_case), so SELECT * rows
// must be mapped onto the camelCase UsageRecord the rest of the app uses. The
// `.all()` result is `unknown[]`, so the mapper takes `unknown` and casts.
function rowToRecord(row: unknown): UsageRecord {
  const r = row as Record<string, unknown>;
  return {
    taskId: r.task_id as string | undefined,
    sessionId: r.session_id as string | undefined,
    agentId: r.agent_id as string | undefined,
    modelId: r.model_id as string | undefined,
    promptTokens: r.prompt_tokens as number,
    completionTokens: r.completion_tokens as number,
    totalTokens: r.total_tokens as number,
    costEstimate: r.cost_estimate as number | undefined,
    createdAt: r.created_at as string | undefined,
  };
}

export class UsageTracker {
  private insert: Database.Statement;
  private select: Database.Statement;

  constructor(private db: Database.Database) {
    this.insert = db.prepare(`INSERT INTO token_usage (task_id, session_id, agent_id, model_id, prompt_tokens, completion_tokens, total_tokens, cost_estimate)
      VALUES (@taskId, @sessionId, @agentId, @modelId, @promptTokens, @completionTokens, @totalTokens, @costEstimate)`);
    this.select = db.prepare('SELECT * FROM token_usage ORDER BY created_at');
  }

  track(r: UsageRecord): void {
    // better-sqlite3 rejects `undefined` bind parameters (RangeError: Missing
    // named parameter), so optional fields must be mapped to NULL explicitly.
    this.insert.run({
      taskId: r.taskId ?? null,
      sessionId: r.sessionId ?? null,
      agentId: r.agentId ?? null,
      modelId: r.modelId ?? null,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      totalTokens: r.totalTokens,
      costEstimate: r.costEstimate ?? null,
    });
  }

  summary(): UsageSummary {
    const rows = this.select.all().map(rowToRecord);
    const byAgent = new Map<string, Usage & { calls: number }>();
    for (const r of rows) {
      const key = r.agentId ?? '(unknown)';
      const cur = byAgent.get(key) ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 };
      cur.promptTokens += r.promptTokens;
      cur.completionTokens += r.completionTokens;
      cur.totalTokens += r.totalTokens;
      cur.calls += 1;
      byAgent.set(key, cur);
    }
    return { total: sumUsage(rows), byAgent: [...byAgent.entries()].map(([agentId, usage]) => ({ agentId, usage })) };
  }

  list(agentId?: string): UsageRecord[] {
    if (!agentId) return this.select.all().map(rowToRecord);
    return this.db.prepare('SELECT * FROM token_usage WHERE agent_id = ? ORDER BY created_at').all(agentId).map(rowToRecord);
  }
}
