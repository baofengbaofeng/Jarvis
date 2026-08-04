import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { EnvInfo } from '@jarvis/protocol';

const exec = promisify(execFile);

export interface EnvDeps {
  execImpl?: (cmd: string, args: string[]) => Promise<{ stdout: string }>;
  daemonRunning?: () => Promise<boolean>;
  whichImpl?: (bin: string) => Promise<string | null>;
}

export async function collectEnvInfo(deps: EnvDeps = {}): Promise<EnvInfo> {
  const run = deps.execImpl ?? (async (cmd, args) => { try { return { stdout: (await exec(cmd, args)).stdout }; } catch { return { stdout: '' }; } });
  const which = deps.whichImpl ?? (async (bin) => { try { await exec('which', [bin]); return bin; } catch { return null; } });
  const [node, go, git, daemonRunning, agentCli] = await Promise.all([
    run('node', ['--version']).then(r => r.stdout.trim()),
    run('go', ['version']).then(r => r.stdout.trim()),
    run('git', ['--version']).then(r => r.stdout.trim()),
    deps.daemonRunning?.() ?? Promise.resolve(false),
    which('jarvis-agent')
  ]);
  return {
    nodeVersion: node,
    goVersion: go || null,
    gitVersion: git || null,
    daemonRunning,
    agentCliOnPath: agentCli !== null
  };
}
