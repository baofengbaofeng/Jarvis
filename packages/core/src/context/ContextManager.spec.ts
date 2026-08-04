import { describe, it, expect, vi } from 'vitest';
import { estimateTokens } from '../util/token';
import { createContextManager } from './ContextManager';

describe('ContextManager', () => {
  it('estimates non-zero tokens', () => {
    expect(estimateTokens('hello world')).toBeGreaterThan(0);
  });

  it('triggers summarization over budget', async () => {
    const summarize = vi.fn().mockResolvedValue('[summary]');
    const cm = createContextManager({ summarizeFn: summarize });
    const history = Array.from({ length: 50 }, (_, i) => ({ role: 'user' as const, content: `line ${i} `.repeat(20) }));
    const out = await cm.maybeSummarize(history, 100, summarize);
    expect(summarize).toHaveBeenCalled();
    expect(out[out.length - 1].content).toBe('[summary]');
  });
});
