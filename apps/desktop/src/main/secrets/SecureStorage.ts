import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function redactSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, '[REDACTED]')
    .replace(/Bearer\s+\S+/g, '[REDACTED]');
}

export interface SecureStorageDeps {
  platform?: NodeJS.Platform;
  /** @deprecated DESK-04: keychain argv path removed; kept for test call-site compat. */
  execImpl?: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
  secretsDir?: string;
  encrypt?: (plain: string) => Buffer;
  decrypt?: (buf: Buffer) => string;
}

export class SecureStorage {
  private secretsDir?: string;
  private encrypt?: (plain: string) => Buffer;
  private decrypt?: (buf: Buffer) => string;

  constructor(deps: SecureStorageDeps = {}) {
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
    // DESK-04: Electron safeStorage-backed files only — never put secrets in argv.
    if (this.encrypt && this.secretsDir) {
      mkdirSync(this.secretsDir, { recursive: true });
      writeFileSync(this.filePath(key), this.encrypt(value));
      return;
    }
    throw new Error('secure storage unavailable on this platform');
  }

  async get(key: string): Promise<string | null> {
    if (this.decrypt && this.secretsDir) {
      const p = this.filePath(key);
      if (!existsSync(p)) return null;
      return this.decrypt(readFileSync(p));
    }
    throw new Error('secure storage unavailable on this platform');
  }

  async delete(key: string): Promise<void> {
    if (this.secretsDir) {
      const p = this.filePath(key);
      if (existsSync(p)) unlinkSync(p);
      return;
    }
    throw new Error('secure storage unavailable on this platform');
  }
}
