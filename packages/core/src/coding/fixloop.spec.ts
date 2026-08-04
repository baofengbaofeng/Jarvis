import { describe, it, expect } from 'vitest';
import { runTestFixLoop } from './fixloop';

describe('test fix loop', () => {
  it('retries with diagnostics feedback until tests pass', async () => {
    let failCount = 2;
    const feedbacks: string[] = [];
    const result = await runTestFixLoop({
      runTests: async () => ({ pass: failCount-- <= 0, output: '1 failed' }),
      pullDiagnostics: async () => ['TS2322: type error at a.ts:1'],
      runEngine: async (fb) => { feedbacks.push(fb); return 'fixed'; }
    }, { maxRetries: 3 });
    expect(result.passed).toBe(true);
    expect(feedbacks.length).toBe(2);
    expect(feedbacks[0]).toContain('TS2322');
  });

  it('gives up after maxRetries exhausted', async () => {
    const result = await runTestFixLoop({
      runTests: async () => ({ pass: false, output: 'still failing' }),
      pullDiagnostics: async () => [],
      runEngine: async () => 'x'
    }, { maxRetries: 1 });
    expect(result.passed).toBe(false);
  });
});
