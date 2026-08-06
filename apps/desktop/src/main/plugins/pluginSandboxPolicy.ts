import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { connect as netConnect } from 'node:net';

export type PermissionLike = {
  has: (scope: string, resource?: string) => boolean;
};

export type SandboxPolicyResult = { ok: boolean; reason?: string };

/**
 * Production utility-process execArgv for the plugin runner.
 *
 * FS grant is limited to the child entry directory (covers the entry + Rollup
 * `chunks/` siblings). Never grants `*`, write, net, child, or worker.
 */
export function buildPluginSandboxExecArgv(childEntry: string): string[] {
  const entryDir = dirname(resolve(childEntry));
  return [
    '--experimental-permission',
    '--no-addons',
    '--max-old-space-size=64',
    `--allow-fs-read=${entryDir}`,
  ];
}

/** Reject unrestricted FS grants before fork (fail closed). */
export function assertPluginSandboxExecArgv(execArgv: readonly string[]): void {
  for (const arg of execArgv) {
    if (arg === '--allow-fs-read=*' || arg.startsWith('--allow-fs-read=*')) {
      throw new Error('PLUGIN_SANDBOX_UNAVAILABLE');
    }
    if (arg === '--allow-fs-write' || arg.startsWith('--allow-fs-write=')) {
      throw new Error('PLUGIN_SANDBOX_UNAVAILABLE');
    }
    if (arg === '--allow-net' || arg.startsWith('--allow-net=')) {
      throw new Error('PLUGIN_SANDBOX_UNAVAILABLE');
    }
    if (arg === '--allow-child-process' || arg.startsWith('--allow-child-process=')) {
      throw new Error('PLUGIN_SANDBOX_UNAVAILABLE');
    }
    if (arg === '--allow-worker' || arg.startsWith('--allow-worker=')) {
      throw new Error('PLUGIN_SANDBOX_UNAVAILABLE');
    }
  }
  if (!execArgv.includes('--experimental-permission')) {
    throw new Error('PLUGIN_SANDBOX_UNAVAILABLE');
  }
}

/**
 * Sync permission-model checks: child/worker denied, arbitrary FS read denied,
 * no FS write. Bootstrap may allowlist only the child entry directory.
 */
export function evaluateSyncSandboxPolicy(
  perm: PermissionLike | undefined,
  fsRead: (path: string) => unknown = (p) => readFileSync(p),
): SandboxPolicyResult {
  if (!perm || typeof perm.has !== 'function') {
    return { ok: false, reason: 'process.permission missing' };
  }
  if (perm.has('child') || perm.has('worker')) {
    return { ok: false, reason: 'child/worker not denied' };
  }
  if (perm.has('fs.read', '/etc/passwd') || perm.has('fs.read', '/')) {
    return { ok: false, reason: 'unrestricted fs read granted' };
  }
  if (perm.has('fs.write') || perm.has('fs.write', '/tmp') || perm.has('fs.write', '/')) {
    return { ok: false, reason: 'fs write granted' };
  }
  try {
    fsRead('/etc/passwd');
    return { ok: false, reason: 'fs read of sentinel succeeded' };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ERR_ACCESS_DENIED') {
      return { ok: false, reason: `fs sentinel unexpected: ${code ?? String(err)}` };
    }
  }
  return { ok: true };
}

function defaultNetProbe(): Promise<{ code?: string }> {
  return new Promise((resolve) => {
    const socket = netConnect({ port: 9, host: '127.0.0.1' });
    const done = (code?: string) => {
      try { socket.destroy(); } catch { /* ignore */ }
      resolve({ code });
    };
    socket.on('error', (err: NodeJS.ErrnoException) => done(err.code));
    socket.on('connect', () => done('NET_CONNECTED'));
    setTimeout(() => done('NET_TIMEOUT'), 250);
  });
}

/**
 * Network must be denied by the permission model (ERR_ACCESS_DENIED).
 * If this Electron/Node build cannot enforce net denial, fail closed.
 */
export async function evaluateNetworkSandboxPolicy(
  perm: PermissionLike | undefined = (process as NodeJS.Process & { permission?: PermissionLike }).permission,
  probe: () => Promise<{ code?: string }> = defaultNetProbe,
): Promise<SandboxPolicyResult> {
  if (perm?.has?.('net')) {
    return { ok: false, reason: 'net permission granted' };
  }
  const result = await probe();
  if (result.code === 'ERR_ACCESS_DENIED') {
    return { ok: true };
  }
  return {
    ok: false,
    reason: `net not denied by permission model (${result.code ?? 'unknown'})`,
  };
}

export async function evaluatePluginSandboxPolicy(
  perm: PermissionLike | undefined = (process as NodeJS.Process & { permission?: PermissionLike }).permission,
): Promise<SandboxPolicyResult> {
  const sync = evaluateSyncSandboxPolicy(perm);
  if (!sync.ok) return sync;
  return evaluateNetworkSandboxPolicy(perm);
}
