import { describe, it, expect } from 'vitest';
import { resumeSession, estimateTokens, type SessionStoreAdapter, type SessionMessage } from './session';

const mkMsgs = (n: number): SessionMessage[] => Array.from({ length: n }, (_, i) => ({ role: 'user' as const, content: `msg ${i} `.repeat(60) }));

describe('resumeSession', () => {
  it('reuses a cached summary without summarizing again', async () => {
    let summarizeCalls = 0;
    const adapter: SessionStoreAdapter = {
      getMessages: async () => mkMsgs(50),
      getSummary: async () => 'cached summary',
      saveSummary: async () => { summarizeCalls++; }
    };
    const out = await resumeSession(adapter, 't1', 2000, async () => 'fresh summary');
    expect(out[0].content).toContain('cached summary');
    expect(summarizeCalls).toBe(0);
  });

  it('summarizes dropped head when over budget and no summary exists', async () => {
    const saved: string[] = [];
    const adapter: SessionStoreAdapter = {
      getMessages: async () => mkMsgs(50),
      getSummary: async () => null,
      saveSummary: async (_t, s) => { saved.push(s); }
    };
    const out = await resumeSession(adapter, 't2', 500, async () => 'fresh summary');
    expect(out.some(m => m.content.includes('fresh summary'))).toBe(true);
    expect(saved).toEqual(['fresh summary']);
  });

  it('keeps all messages when within budget', async () => {
    const adapter: SessionStoreAdapter = {
      getMessages: async () => [{ role: 'user', content: 'hi' }],
      getSummary: async () => null,
      saveSummary: async () => {}
    };
    const out = await resumeSession(adapter, 't3', 100_000, async () => 'x');
    expect(out.length).toBe(1);
  });
});

describe('estimateTokens', () => {
  it('approximates tokens from length', () => {
    expect(estimateTokens('abcde')).toBe(3);
  });
});
