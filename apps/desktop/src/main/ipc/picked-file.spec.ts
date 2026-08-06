import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setLastPickedFile, readLastPickedFile, clearLastPickedFile } from './picked-file';

describe('picked-file', () => {
  beforeEach(() => clearLastPickedFile());

  it('reads only the last dialog-picked path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-pick-'));
    const file = join(dir, 'config.json');
    writeFileSync(file, '{"ok":true}', 'utf8');
    setLastPickedFile(file);
    expect(readLastPickedFile(file)).toBe('{"ok":true}');
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects paths not from the picker', () => {
    setLastPickedFile('/tmp/allowed.json');
    const r = readLastPickedFile('/etc/passwd');
    expect(r).toEqual({ ok: false, error: 'path not from file picker' });
  });
});
