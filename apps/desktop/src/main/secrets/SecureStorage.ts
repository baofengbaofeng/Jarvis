import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
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
  secretsDir?: string;
  encrypt?: (plain: string) => Buffer;
  decrypt?: (buf: Buffer) => string;
}

const SERVICE = 'jarvis';

export class SecureStorage {
  private platform: NodeJS.Platform;
  private run: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
  private secretsDir?: string;
  private encrypt?: (plain: string) => Buffer;
  private decrypt?: (buf: Buffer) => string;

  constructor(deps: SecureStorageDeps = {}) {
    this.platform = deps.platform ?? process.platform;
    this.run = deps.execImpl ?? (async (cmd, args) => {
      try { return await exec(cmd, args); } catch (e) {
        const err = e as { stderr?: string; stdout?: string };
        return { stdout: err.stdout ?? '', stderr: err.stderr ?? String(e) };
      }
    });
    this.secretsDir = deps.secretsDir;
    this.encrypt = deps.encrypt;
    this.decrypt = deps.decrypt;
  }

  private filePath(key: string): string {
    if (!this.secretsDir) throw new Error('secretsDir required');
    const hash = createHash('sha256').update(key).digest('hex');
    return join(this.secretsDir, hash);
  }

  async set(key: string, value: string): Promise<void> {
    if (this.platform === 'darwin') {
      const r = await this.run('security', ['add-generic-password', '-U', '-a', SERVICE, '-s', key, '-w', value]);
      if (r.stderr) throw new Error('keychain error: ' + r.stderr);
      return;
    }
    if (this.encrypt && this.secretsDir) {
      mkdirSync(this.secretsDir, { recursive: true });
      writeFileSync(this.filePath(key), this.encrypt(value));
      return;
    }
    throw new Error('secure storage unavailable on this platform');
  }

  async get(key: string): Promise<string | null> {
    if (this.platform === 'darwin') {
      const r = await this.run('security', ['find-generic-password', '-a', SERVICE, '-s', key, '-w']);
      if (r.stderr && !r.stdout) return null;
      return r.stdout.trim() || null;
    }
    if (this.decrypt && this.secretsDir) {
      const p = this.filePath(key);
      if (!existsSync(p)) return null;
      return this.decrypt(readFileSync(p));
    }
    throw new Error('secure storage unavailable on this platform');
  }

  async delete(key: string): Promise<void> {
    if (this.platform === 'darwin') {
      const r = await this.run('security', ['delete-generic-password', '-a', SERVICE, '-s', key]);
      if (r.stderr) throw new Error('keychain error: ' + r.stderr);
      return;
    }
    if (this.secretsDir) {
      const p = this.filePath(key);
      if (existsSync(p)) unlinkSync(p);
    }
  }
}
