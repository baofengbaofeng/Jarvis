import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { encodeRpcFrame, hashPluginSource, type PluginDescriptor } from '@jarvis/core';
import {
  PluginRunnerHost,
  buildPluginSandboxExecArgv,
} from './PluginRunnerHost';
import {
  evaluateNetworkSandboxPolicy,
  evaluateSyncSandboxPolicy,
} from './pluginSandboxPolicy';

/**
 * Permission-model integration under the **production** execArgv builder.
 * Probes run via Electron's Node (ELECTRON_RUN_AS_NODE) — no BrowserWindow.
 */
describe('plugin sandbox integration (permission model)', () => {
  const require = createRequire(import.meta.url);
  let electronPath = '';
  try {
    electronPath = require('electron') as unknown as string;
  } catch {
    electronPath = '';
  }

  /** Place probes under out/main so buildPluginSandboxExecArgv allowlist matches production. */
  const probeDir = realpathSync(join(process.cwd(), 'out', 'main'));

  const runWithProductionArgv = (script: string): { status: number | null; stdout: string; stderr: string } => {
    if (!electronPath) return { status: 1, stdout: '', stderr: 'no-electron' };
    mkdirSync(probeDir, { recursive: true });
    const file = join(probeDir, `sandbox-probe-${process.pid}.cjs`);
    writeFileSync(file, script, 'utf8');
    const execArgv = buildPluginSandboxExecArgv(file);
    expect(execArgv.some((a) => a.includes('--allow-fs-read=*'))).toBe(false);
    try {
      const r = spawnSync(electronPath, [...execArgv, file], {
        env: { ELECTRON_RUN_AS_NODE: '1', PATH: process.env.PATH ?? '' },
        encoding: 'utf8',
        timeout: 5_000,
      });
      return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    } finally {
      try { rmSync(file, { force: true }); } catch { /* ignore */ }
    }
  };

  it('denies filesystem read outside the bootstrap allowlist under production execArgv', () => {
    if (!electronPath) return;
    const r = runWithProductionArgv(`
      const out = [];
      try { require('fs').readFileSync('/etc/passwd'); out.push('FS_OK'); }
      catch (e) { out.push('FS_' + (e.code || e.message)); }
      out.push(process.permission ? 'PERM_OK' : 'NO_PERM');
      out.push('HAS_ETC_' + process.permission.has('fs.read', '/etc/passwd'));
      process.stdout.write(out.join('|'));
    `);
    expect(r.stdout).toContain('FS_ERR_ACCESS_DENIED');
    expect(r.stdout).toContain('PERM_OK');
    expect(r.stdout).toContain('HAS_ETC_false');
  });

  it('denies child_process spawn under production execArgv', () => {
    if (!electronPath) return;
    const r = runWithProductionArgv(`
      const out = [];
      try { require('child_process').spawnSync('echo', ['hi']); out.push('SPAWN_OK'); }
      catch (e) { out.push('SPAWN_' + (e.code || e.message)); }
      out.push(process.permission ? 'PERM_OK' : 'NO_PERM');
      process.stdout.write(out.join('|'));
    `);
    expect(r.stdout).toContain('SPAWN_ERR_ACCESS_DENIED');
    expect(r.stdout).toContain('PERM_OK');
  });

  it('requires permission-model net denial or fail-closes the sandbox policy', async () => {
    if (!electronPath) return;
    const r = runWithProductionArgv(`
      const out = [];
      const perm = process.permission;
      out.push('HAS_NET_' + (perm && perm.has('net')));
      try {
        const net = require('net');
        const s = net.connect(9, '127.0.0.1');
        s.on('error', (e) => { out.push('NET_' + (e.code || e.message)); process.stdout.write(out.join('|')); });
        s.on('connect', () => { out.push('NET_CONNECTED'); process.stdout.write(out.join('|')); process.exit(0); });
        setTimeout(() => { out.push('NET_TIMEOUT'); process.stdout.write(out.join('|')); process.exit(0); }, 300);
      } catch (e) {
        out.push('NET_' + (e.code || e.message));
        process.stdout.write(out.join('|'));
      }
    `);
    const netDenied = r.stdout.includes('NET_ERR_ACCESS_DENIED');
    if (netDenied) {
      expect(netDenied).toBe(true);
      return;
    }
    // Electron 32 / Node 20: net connects are not permission-gated → fail closed.
    const policy = await evaluateNetworkSandboxPolicy(
      { has: () => false },
      async () => {
        const code = r.stdout.includes('NET_CONNECTED')
          ? 'NET_CONNECTED'
          : r.stdout.match(/NET_([A-Z0-9_]+)/)?.[1];
        return { code };
      },
    );
    expect(policy.ok).toBe(false);
    expect(policy.reason).toMatch(/net not denied/);
  });

  it('fail-closes sync policy when --allow-fs-read=* would grant unrestricted read', () => {
    const perm = {
      has: (scope: string, resource?: string) =>
        scope === 'fs.read' && (resource === '/etc/passwd' || resource === '/' || resource === undefined),
    };
    const r = evaluateSyncSandboxPolicy(perm, () => Buffer.from('x'));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/unrestricted fs read|fs read of sentinel/);
  });

  it('surfaces PLUGIN_SANDBOX_UNAVAILABLE when the child reports sandbox failure', async () => {
    class FakeChild extends EventEmitter {
      kill = () => true;
      postMessage = () => {
        queueMicrotask(() => {
          this.emit('message', encodeRpcFrame({
            type: 'sandbox',
            available: false,
            reason: 'net not denied by permission model',
          }));
        });
      };
    }
    const SOURCE = 'registerTool({name:"t",description:"",parameters:{}}, async()=>({ok:true,output:"x"}));';
    const descriptor: PluginDescriptor = {
      manifest: { schemaVersion: 1, id: 'p1', name: 'P1', entry: 'index.js', permissions: [] },
      root: '/plugins/p1',
      entryPath: '/plugins/p1/index.js',
      sha256: hashPluginSource(SOURCE),
    };
    const host = new PluginRunnerHost({
      fork: () => new FakeChild() as never,
      approval: async () => true,
      readSource: async () => SOURCE,
    });
    await expect(host.load(descriptor, descriptor.sha256)).rejects.toThrow('PLUGIN_SANDBOX_UNAVAILABLE');
    expect(host.probe()).toEqual({ ok: true });
  });
});
