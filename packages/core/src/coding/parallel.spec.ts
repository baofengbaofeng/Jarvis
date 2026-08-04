import { describe, it, expect } from 'vitest';
import { runParallel } from './parallel';

describe('runParallel', () => {
  it('respects the concurrency cap', async () => {
    let active = 0, peak = 0;
    const run = async () => {
      active++; peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, 5));
      active--;
    };
    const tasks = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, workspace: '/ws', run }));
    await runParallel(tasks, 3);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('runs all tasks to completion', async () => {
    let done = 0;
    const tasks = Array.from({ length: 5 }, () => ({ id: 't', workspace: '/ws', run: async () => { done++; } }));
    await runParallel(tasks, 2);
    expect(done).toBe(5);
  });
});
