import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export function makeTempWorkspace(files?: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-workspace-'));
  if (files) {
    for (const [relativePath, content] of Object.entries(files)) {
      const fullPath = join(dir, relativePath);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, content, 'utf8');
    }
  }
  return dir;
}

export function removeTempWorkspace(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}
