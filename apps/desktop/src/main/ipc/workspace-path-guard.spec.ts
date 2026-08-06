import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertAllowedWorkspaceRoot, assertWorkspaceRelPath } from './workspace-path-guard';

describe('workspace-path-guard (SEC-07)', () => {
  it('assertAllowedWorkspaceRoot accepts active and bound workspaces only', () => {
    const ws = mkdtempSync(join(tmpdir(), 'jarvis-ws-'));
    const other = mkdtempSync(join(tmpdir(), 'jarvis-other-'));
    try {
      expect(assertAllowedWorkspaceRoot(ws, () => ws, () => [other])).toBe(ws);
      expect(assertAllowedWorkspaceRoot(other, () => ws, () => [other])).toBe(other);
      expect(() => assertAllowedWorkspaceRoot('/tmp/not-bound', () => ws, () => [other])).toThrow(/not allowed/);
    } finally {
      rmSync(ws, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('assertWorkspaceRelPath rejects traversal and accepts in-workspace files', () => {
    const ws = mkdtempSync(join(tmpdir(), 'jarvis-rel-'));
    try {
      mkdirSync(join(ws, 'src'));
      writeFileSync(join(ws, 'src', 'a.ts'), 'x');
      expect(assertWorkspaceRelPath(ws, 'src/a.ts')).toBe('src/a.ts');
      expect(() => assertWorkspaceRelPath(ws, '../outside')).toThrow();
      expect(() => assertWorkspaceRelPath(ws, '/etc/passwd')).toThrow(/relative/);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('assertWorkspaceRelPath rejects symlink escape', () => {
    const ws = mkdtempSync(join(tmpdir(), 'jarvis-sym-'));
    const outside = mkdtempSync(join(tmpdir(), 'jarvis-out-'));
    try {
      writeFileSync(join(outside, 'secret.txt'), 'secret');
      symlinkSync(join(outside, 'secret.txt'), join(ws, 'link.txt'));
      expect(() => assertWorkspaceRelPath(ws, 'link.txt')).toThrow(/outside workspace/);
    } finally {
      rmSync(ws, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
