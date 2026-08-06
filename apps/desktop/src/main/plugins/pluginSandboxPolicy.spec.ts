import { describe, it, expect } from 'vitest';
import {
  assertPluginSandboxExecArgv,
  buildPluginSandboxExecArgv,
  evaluateNetworkSandboxPolicy,
  evaluateSyncSandboxPolicy,
} from './pluginSandboxPolicy';

describe('pluginSandboxPolicy', () => {
  it('builds a directory-scoped allow-fs-read and never uses *', () => {
    const argv = buildPluginSandboxExecArgv('/app/out/main/plugin-runner-child.js');
    expect(argv).toContain('--experimental-permission');
    expect(argv).toContain('--no-addons');
    expect(argv).toContain('--max-old-space-size=64');
    expect(argv.some((a) => a.includes('--allow-fs-read=*'))).toBe(false);
    expect(argv.some((a) => a.startsWith('--allow-fs-read=') && a.endsWith('/main'))).toBe(true);
    expect(() => assertPluginSandboxExecArgv(argv)).not.toThrow();
  });

  it('fail-closes on unrestricted fs or privilege grants in execArgv', () => {
    expect(() => assertPluginSandboxExecArgv([
      '--experimental-permission',
      '--allow-fs-read=*',
    ])).toThrow('PLUGIN_SANDBOX_UNAVAILABLE');
    expect(() => assertPluginSandboxExecArgv([
      '--experimental-permission',
      '--allow-fs-read=/app/out/main',
      '--allow-net',
    ])).toThrow('PLUGIN_SANDBOX_UNAVAILABLE');
  });

  it('rejects sync policy when fs read of sentinel is allowed', () => {
    const perm = {
      has: (scope: string, resource?: string) =>
        scope === 'fs.read' && (resource === '/etc/passwd' || resource === '/'),
    };
    expect(evaluateSyncSandboxPolicy(perm, () => { throw Object.assign(new Error('x'), { code: 'ERR_ACCESS_DENIED' }); }).ok)
      .toBe(false);
  });

  it('accepts sync policy when fs/child/worker are denied', () => {
    const perm = { has: () => false };
    const r = evaluateSyncSandboxPolicy(perm, () => {
      throw Object.assign(new Error('denied'), { code: 'ERR_ACCESS_DENIED' });
    });
    expect(r).toEqual({ ok: true });
  });

  it('fail-closes network policy when connect is not ACCESS_DENIED', async () => {
    const perm = { has: () => false };
    await expect(evaluateNetworkSandboxPolicy(perm, async () => ({ code: 'ECONNREFUSED' })))
      .resolves.toMatchObject({ ok: false });
    await expect(evaluateNetworkSandboxPolicy(perm, async () => ({ code: 'ERR_ACCESS_DENIED' })))
      .resolves.toEqual({ ok: true });
  });
});
