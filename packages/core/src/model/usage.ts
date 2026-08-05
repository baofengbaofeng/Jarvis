// B9 token usage accounting. Pure functions (renderer-safe): they only count
// characters/numbers, no node:* or I/O. `Usage` is shared with model/types.ts;
// `UsageRecord` is the persisted shape (token_usage row) and the common carrier
// for aggregation/cost estimation.
import type { Usage } from './types';

export interface UsageRecord {
  taskId?: string;
  sessionId?: string;
  agentId?: string;
  modelId?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costEstimate?: number;
  createdAt?: string;
}

// Rough token estimate: 4 ASCII chars ≈ 1 token, 1 CJK char ≈ 1.5 tokens.
// Bounded below at 1 so an empty prompt still counts as one token.
//
// Named estimateUsageTokens (NOT `estimateTokens`) because @jarvis/core already
// exports an unrelated `estimateTokens` (coding/session.ts: ceil(len/2)); a
// second barrel export of that name is a TS2308 duplicate-member error.
export function estimateUsageTokens(text: string): number {
  let cjk = 0;
  let ascii = 0;
  for (const ch of text) {
    if ((ch.codePointAt(0) ?? 0) > 0x2e7f) cjk += 1;
    else ascii += 1;
  }
  return Math.max(1, Math.ceil(ascii / 4 + cjk * 1.5));
}

export function estimateUsage(prompt: string, completion: string): Usage {
  return {
    promptTokens: estimateUsageTokens(prompt),
    completionTokens: estimateUsageTokens(completion),
    totalTokens: estimateUsageTokens(prompt) + estimateUsageTokens(completion),
  };
}

export function sumUsage(
  records: Pick<UsageRecord, 'promptTokens' | 'completionTokens' | 'totalTokens'>[]
): Usage & { calls: number } {
  const s = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  for (const r of records) {
    s.promptTokens += r.promptTokens;
    s.completionTokens += r.completionTokens;
    s.totalTokens += r.totalTokens;
  }
  return { ...s, calls: records.length };
}

// Cost in dollars from per-1M-token rates.
export function estimateCost(records: UsageRecord[], price: { inputPerM: number; outputPerM: number }): number {
  return records.reduce((acc, r) => acc + (r.promptTokens * price.inputPerM + r.completionTokens * price.outputPerM) / 1_000_000, 0);
}
