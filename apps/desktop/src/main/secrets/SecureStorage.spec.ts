import { describe, it, expect } from 'vitest';
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
        // Coherent mock: the `set` command is add-generic-password (stdout empty);
        // the `get` command is find-generic-password (stdout is the secret).
        if (args.includes('add-generic-password')) return { stdout: '', stderr: '' };
        return { stdout: 'sekret', stderr: '' };
      }
    });
    await store.set('provider.p1', 'sk-sekret');
    const got = await store.get('provider.p1');
    expect(got).toBe('sekret');
    expect(calls.some(c => c.includes('add-generic-password'))).toBe(true);
  });
});
