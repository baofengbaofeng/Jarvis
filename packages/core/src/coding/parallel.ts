export interface ParallelTask { id: string; workspace: string; run: () => Promise<unknown> }

export async function runParallel(tasks: ParallelTask[], concurrency: number): Promise<void> {
  const queue = [...tasks];
  const worker = async () => {
    while (queue.length > 0) {
      const t = queue.shift()!;
      await t.run();
    }
  };
  const n = Math.max(1, Math.min(concurrency, tasks.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
}
