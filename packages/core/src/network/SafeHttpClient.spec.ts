import { describe, expect, it } from 'vitest';
import { isRestrictedAddress } from './SafeHttpClient';

describe('isRestrictedAddress', () => {
  const publicV4 = ['8.8.8.8', '203.0.113.10', '1.1.1.1'];
  const restrictedV4 = [
    ['0.0.0.0', '0.0.0.0/8'],
    ['10.1.2.3', '10/8'],
    ['100.64.0.1', '100.64/10'],
    ['127.0.0.1', '127/8'],
    ['169.254.1.1', '169.254/16'],
    ['172.16.0.1', '172.16/12'],
    ['192.0.0.1', '192.0.0/24'],
    ['192.168.1.2', '192.168/16'],
    ['198.18.0.1', '198.18/15'],
    ['224.0.0.1', '224/4'],
    ['240.0.0.1', '240/4'],
  ] as const;

  it.each(publicV4)('allows public IPv4 %s', (addr) => {
    expect(isRestrictedAddress(addr)).toBe(false);
  });

  it.each(restrictedV4)('blocks restricted IPv4 %s (%s)', (addr) => {
    expect(isRestrictedAddress(addr)).toBe(true);
  });

  it.each(['::1', 'fe80::1', 'fc00::1', 'ff02::1', '::'])('blocks restricted IPv6 %s', (addr) => {
    expect(isRestrictedAddress(addr)).toBe(true);
  });

  it('blocks IPv4-mapped restricted addresses', () => {
    expect(isRestrictedAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isRestrictedAddress('::ffff:10.0.0.1')).toBe(true);
    expect(isRestrictedAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('allows loopback only when allowLoopback is set', () => {
    expect(isRestrictedAddress('127.0.0.1')).toBe(true);
    expect(isRestrictedAddress('::1')).toBe(true);
    expect(isRestrictedAddress('127.0.0.1', { allowLoopback: true })).toBe(false);
    expect(isRestrictedAddress('::1', { allowLoopback: true })).toBe(false);
    expect(isRestrictedAddress('10.0.0.1', { allowLoopback: true })).toBe(true);
  });
});
