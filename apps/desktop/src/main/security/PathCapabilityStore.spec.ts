import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, symlinkSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PathCapabilityStore } from './PathCapabilityStore';

describe('PathCapabilityStore', () => {
  it('binds token to canonical path, window, operation and expiry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-cap-'));
    const file = join(dir, 'report.pdf');
    writeFileSync(file, 'pdf');
    let now = 100;
    const caps = new PathCapabilityStore({ now: () => now, randomToken: () => 'token' });
    const cap = caps.issue(file, 7, ['office:read'], 50);
    expect(caps.resolve(cap.token, 7, 'office:read')).toBe(realpathSync(file));
    expect(() => caps.resolve(cap.token, 8, 'office:read')).toThrow('PATH_CAPABILITY_OWNER');
    expect(() => caps.resolve(cap.token, 7, 'workspace:copy')).toThrow('PATH_CAPABILITY_OPERATION');
    now = 151;
    expect(() => caps.resolve(cap.token, 7, 'office:read')).toThrow('PATH_CAPABILITY_EXPIRED');
  });

  it('detects a symlink target change after issue', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-cap-link-'));
    const a = join(dir, 'a'); const b = join(dir, 'b'); const link = join(dir, 'link');
    writeFileSync(a, 'a'); writeFileSync(b, 'b'); symlinkSync(a, link);
    const caps = new PathCapabilityStore();
    const cap = caps.issue(link, 1, ['office:read']);
    vi.spyOn(caps as never, 'canonicalize' as never).mockReturnValueOnce(b as never);
    expect(() => caps.resolve(cap.token, 1, 'office:read')).toThrow('PATH_CAPABILITY_CHANGED');
  });
});
