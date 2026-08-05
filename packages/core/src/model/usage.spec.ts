import { describe, it, expect } from 'vitest';
import { estimateUsageTokens, estimateUsage, sumUsage, estimateCost } from './usage';

describe('usage', () => {
  it('estimates tokens by CJK vs ascii weighting', () => {
    expect(estimateUsageTokens('')).toBe(1);
    expect(estimateUsageTokens('hello world this is long text content')).toBeGreaterThan(5);
    expect(estimateUsageTokens('你好,世界')).toBeGreaterThan(2);
  });
  it('estimateUsage totals prompt + completion', () => {
    const u = estimateUsage('say hi', 'hi');
    expect(u.totalTokens).toBe(u.promptTokens + u.completionTokens);
  });
  it('sumUsage aggregates and counts calls', () => {
    const s = sumUsage([{ promptTokens: 1, completionTokens: 2, totalTokens: 3 }, { promptTokens: 4, completionTokens: 5, totalTokens: 9 }]);
    expect(s).toEqual({ promptTokens: 5, completionTokens: 7, totalTokens: 12, calls: 2 });
  });
  it('estimateCost converts per-million rates', () => {
    expect(estimateCost([{ promptTokens: 1_000_000, completionTokens: 500_000, totalTokens: 1_500_000 }], { inputPerM: 3, outputPerM: 15 })).toBe(10.5);
  });
});
