import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { jarvisDataDir } from '../db/connection';

export interface LogFileEntry {
  name: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface LogLine {
  line: number;
  text: string;
}

function logsDir(): string {
  return join(jarvisDataDir(), 'logs');
}

export function listLogFiles(): LogFileEntry[] {
  const dir = logsDir();
  try {
    return readdirSync(dir)
      .filter(name => !name.startsWith('.'))
      .map(name => {
        const path = join(dir, name);
        const st = statSync(path);
        if (!st.isFile()) return null;
        return { name, sizeBytes: st.size, updatedAt: st.mtime.toISOString() };
      })
      .filter((e): e is LogFileEntry => e != null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

export function readLogFile(name: string, opts: { tail?: number } = {}): { ok: true; lines: LogLine[] } | { ok: false; error: string } {
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) {
    return { ok: false, error: 'invalid log name' };
  }
  const path = join(logsDir(), name);
  try {
    const raw = readFileSync(path, 'utf8');
    const all = raw.split(/\r?\n/);
    const tail = Math.max(1, Math.min(opts.tail ?? 500, 5000));
    const slice = all.length > tail ? all.slice(-tail) : all;
    const start = all.length - slice.length;
    return {
      ok: true,
      lines: slice.map((text, i) => ({ line: start + i + 1, text })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function createLogsIpc() {
  return {
    list: () => listLogFiles(),
    read: (name: string, opts?: { tail?: number }) => readLogFile(name, opts),
  };
}
