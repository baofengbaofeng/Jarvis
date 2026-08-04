import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runParallel } from '../coding/parallel';

// M4 Task 9 (E14): runParallel isolates tasks by giving each its OWN workspace
// root (the engine holds a per-task Sandbox rooted at task.workspace and its own
// MCP session). This integration spec exercises the real file tools on two
// independent temp-dir workspaces running concurrently and asserts each file
// lands in its own workspace — no cross-contamination.
describe('runParallel E14 isolation', () => {
  it('runs two tasks with independent workspaces concurrently without cross-contamination', async () => {
    const wsA = mkdtempSync(join(tmpdir(), 'jarvis-par-a-'));
    const wsB = mkdtempSync(join(tmpdir(), 'jarvis-par-b-'));
    try {
      let done = 0;
      const tasks = [
        { id: 'a', workspace: wsA, run: async () => { writeFileSync(join(wsA, 'out.txt'), 'from A'); done++; } },
        { id: 'b', workspace: wsB, run: async () => { writeFileSync(join(wsB, 'out.txt'), 'from B'); done++; } }
      ];
      await runParallel(tasks, 2);
      expect(done).toBe(2);
      expect(readFileSync(join(wsA, 'out.txt'), 'utf8')).toBe('from A');
      expect(readFileSync(join(wsB, 'out.txt'), 'utf8')).toBe('from B');
      // The other task's file must NOT appear in this workspace.
      expect(readFileSync(join(wsA, 'out.txt'), 'utf8')).not.toBe('from B');
      expect(readFileSync(join(wsB, 'out.txt'), 'utf8')).not.toBe('from A');
    } finally {
      rmSync(wsA, { recursive: true, force: true });
      rmSync(wsB, { recursive: true, force: true });
    }
  });
});
