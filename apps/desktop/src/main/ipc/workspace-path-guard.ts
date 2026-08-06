import { realpathSync } from 'node:fs';
import { join, resolve, isAbsolute, relative } from 'node:path';
import { Sandbox } from '@jarvis/core';

function normalizeRoot(p: string): string {
  try { return realpathSync(p); } catch { return resolve(p); }
}

/** Reject paths outside bound workspaces (SEC-07). */
export function assertAllowedWorkspaceRoot(
  requested: string,
  active: () => string | null,
  bound: () => string[],
): string {
  const req = normalizeRoot(requested);
  const cur = active();
  if (cur && normalizeRoot(cur) === req) return requested.replace(/[\\/]+$/, '');
  for (const b of bound()) {
    if (normalizeRoot(b) === req) return requested.replace(/[\\/]+$/, '');
  }
  throw new Error('workspace not allowed');
}

/** Validate a workspace-relative path; returns normalized relative path for coding IPC. */
export function assertWorkspaceRelPath(wsRoot: string, relPath: string): string {
  if (!relPath || typeof relPath !== 'string') throw new Error('path required');
  if (isAbsolute(relPath)) throw new Error('path must be relative');
  const normalized = relPath.replace(/\\/g, '/');
  if (normalized.split('/').some(seg => seg === '..')) throw new Error('path traversal not allowed');
  const abs = join(wsRoot, normalized);
  const sb = new Sandbox(wsRoot, { level: 'readonly', allowDomains: [], allowCommands: [] });
  const canonical = sb.assertRead(abs);
  const root = normalizeRoot(wsRoot);
  return relative(root, canonical).replace(/\\/g, '/');
}
