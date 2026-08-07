import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pkgRoot = fileURLToPath(new URL('..', import.meta.url));
const distEntry = join(pkgRoot, 'dist', 'headless.mjs');
const srcEntry = join(pkgRoot, 'src', 'headless.mjs');

describe('headless entry (DAEM-01)', () => {
  it('source entry exists', () => {
    expect(existsSync(srcEntry)).toBe(true);
  });

  it('dist/headless.mjs exists after build', () => {
    expect(existsSync(distEntry)).toBe(true);
  });

  it('emits a JSONL result frame for a valid spec', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-headless-'));
    try {
      const specPath = join(dir, 'spec.json');
      writeFileSync(
        specPath,
        JSON.stringify({
          workspace: dir,
          initialMessages: [{ role: 'user', content: 'hello' }],
        }),
      );
      const entry = existsSync(distEntry) ? distEntry : srcEntry;
      const r = spawnSync(process.execPath, [entry, '--spec', specPath], {
        encoding: 'utf8',
      });
      const lines = (r.stdout || '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const frames = lines.map((l) => JSON.parse(l));
      const result = frames.find((f) => f.type === 'result');
      expect(result).toBeTruthy();
      expect(['completed', 'failed']).toContain(result.status);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
