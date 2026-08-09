/** Tiny async semaphore for capping concurrent MCP tool calls. */
export function createSemaphore(limit: number) {
  let active = 0;
  const waiters: Array<() => void> = [];
  const max = Math.max(1, Math.floor(limit));

  async function acquire(): Promise<void> {
    if (active < max) {
      active++;
      return;
    }
    await new Promise<void>((resolve) => waiters.push(resolve));
    active++;
  }

  function release(): void {
    active = Math.max(0, active - 1);
    const next = waiters.shift();
    if (next) next();
  }

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}
