import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

export function redactSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, '[REDACTED]')
    .replace(/Bearer\s+\S+/g, '[REDACTED]');
}

export interface SecureStorageDeps {
  platform?: NodeJS.Platform;
  execImpl?: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
}

const SERVICE = 'jarvis';

export class SecureStorage {
  private platform: NodeJS.Platform;
  private run: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

  constructor(deps: SecureStorageDeps = {}) {
    this.platform = deps.platform ?? process.platform;
    this.run = deps.execImpl ?? (async (cmd, args) => {
      try { return await exec(cmd, args); } catch (e) {
        const err = e as { stderr?: string; stdout?: string };
        return { stdout: err.stdout ?? '', stderr: err.stderr ?? String(e) };
      }
    });
  }

  async set(key: string, value: string): Promise<void> {
    if (this.platform === 'darwin') {
      await this.run('security', ['add-generic-password', '-U', '-a', SERVICE, '-s', key, '-w', value]);
      return;
    }
    throw new Error('secure storage for windows (DPAPI) lands in M8');
  }

  async get(key: string): Promise<string | null> {
    if (this.platform === 'darwin') {
      const r = await this.run('security', ['find-generic-password', '-a', SERVICE, '-s', key, '-w']);
      if (r.stderr && !r.stdout) return null;
      return r.stdout.trim() || null;
    }
    throw new Error('secure storage for windows (DPAPI) lands in M8');
  }

  async delete(key: string): Promise<void> {
    if (this.platform === 'darwin') {
      await this.run('security', ['delete-generic-password', '-a', SERVICE, '-s', key]);
    }
  }
}
