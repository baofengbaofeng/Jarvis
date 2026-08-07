import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('logs ipc', () => {
  let prev: string | undefined;
  let dir: string;

  beforeEach(() => {
    prev = process.env.JARVIS_DATA_DIR;
    dir = mkdtempSync(join(tmpdir(), 'jarvis-logs-'));
    process.env.JARVIS_DATA_DIR = dir;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.JARVIS_DATA_DIR;
    else process.env.JARVIS_DATA_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists and reads log files under ~/.jarvis/logs', async () => {
    const { createLogsIpc } = await import('./logs');
    const logs = createLogsIpc();
    const logsPath = join(dir, 'logs');
    mkdirSync(logsPath, { recursive: true });
    writeFileSync(join(logsPath, 'daemon.log'), 'line1\nline2\nline3\n', 'utf8');
    const files = logs.list();
    expect(files.some(f => f.name === 'daemon.log')).toBe(true);
    const content = logs.read('daemon.log', { tail: 2 });
    expect(content.ok).toBe(true);
    if (content.ok) {
      expect(content.lines.length).toBeGreaterThanOrEqual(2);
      expect(content.lines.at(-2)?.text).toBe('line3');
    }
    expect(logs.read('../evil').ok).toBe(false);
  });
});
