import { describe, expect, it } from 'vitest';
import { createSemaphore } from './concurrency';

describe('createSemaphore', () => {
  it('limits concurrent runners', async () => {
    const sem = createSemaphore(2);
    let concurrent = 0;
    let peak = 0;
    await Promise.all(Array.from({ length: 6 }, () =>
      sem.run(async () => {
        concurrent++;
        peak = Math.max(peak, concurrent);
        await new Promise((r) => setTimeout(r, 20));
        concurrent--;
      }),
    ));
    expect(peak).toBeLessThanOrEqual(2);
  });
});
