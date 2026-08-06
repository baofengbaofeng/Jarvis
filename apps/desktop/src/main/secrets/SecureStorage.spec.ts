import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SecureStorage, redactSecrets } from './SecureStorage';

describe('SecureStorage', () => {
  it('redacts sk- and Bearer tokens', () => {
    expect(redactSecrets('key sk-abc123XYZ and Bearer tok_99')).toBe('key [REDACTED] and [REDACTED]');
  });

  it('stores via keychain exec and retrieves', async () => {
    const calls: string[] = [];
    const store = new SecureStorage({
      platform: 'darwin' as NodeJS.Platform,
      execImpl: async (cmd, args) => {
        calls.push(cmd + ' ' + args.join(' '));
        if (args.includes('add-generic-password')) return { stdout: '', stderr: '' };
        return { stdout: 'sekret', stderr: '' };
      }
    });
    await store.set('provider.p1', 'sk-sekret');
    const got = await store.get('provider.p1');
    expect(got).toBe('sekret');
    expect(calls.some(c => c.includes('add-generic-password'))).toBe(true);
  });

  it('stores via encrypted file when encrypt/decrypt provided', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-sec-'));
    const store = new SecureStorage({
      platform: 'win32',
      secretsDir: dir,
      encrypt: (s) => Buffer.from(`enc:${s}`),
      decrypt: (b) => b.toString().replace(/^enc:/, ''),
    });
    await store.set('provider.p1', 'sk-sekret');
    expect(await store.get('provider.p1')).toBe('sk-sekret');
    await store.delete('provider.p1');
    expect(await store.get('provider.p1')).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});
