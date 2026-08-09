import { describe, expect, it, vi } from 'vitest';
import { SafeUrlPolicy } from './SafeUrlPolicy';

describe('SafeUrlPolicy', () => {
  it('rejects non-https, credentials and private DNS answers', async () => {
    const policy = new SafeUrlPolicy({ lookup: async () => [{ address: '10.1.2.3', family: 4 }] });
    await expect(policy.assertAllowed('http://public.example')).rejects.toThrow('URL_HTTPS_REQUIRED');
    await expect(policy.assertAllowed('https://u:p@public.example')).rejects.toThrow('URL_CREDENTIALS_FORBIDDEN');
    await expect(policy.assertAllowed('https://public.example')).rejects.toThrow('URL_PRIVATE_ADDRESS');
  });

  it.each(['127.0.0.1', '169.254.1.1', '192.168.1.2', '172.16.0.1', '::1', 'fe80::1', 'fc00::1'])(
    'rejects restricted address %s', async (address) => {
      const policy = new SafeUrlPolicy({ lookup: async () => [{ address, family: address.includes(':') ? 6 : 4 }] });
      await expect(policy.assertAllowed('https://x.example')).rejects.toThrow('URL_PRIVATE_ADDRESS');
    });

  it('revalidates redirect targets', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://internal.example/' } }));
    const policy = new SafeUrlPolicy({
      lookup: async host => [{ address: host === 'internal.example' ? '127.0.0.1' : '203.0.113.10', family: 4 }],
      fetchImpl,
    });
    await expect(policy.request('https://public.example', {}, {
      timeoutMs: 15_000, maxRedirects: 3, maxResponseBytes: 5 * 1024 * 1024,
    })).rejects.toThrow('URL_PRIVATE_ADDRESS');
  });

  it('defaults allowLoopbackDev to off', async () => {
    const policy = new SafeUrlPolicy({ lookup: async () => [{ address: '127.0.0.1', family: 4 }] });
    await expect(policy.assertAllowed('https://localhost')).rejects.toThrow('URL_PRIVATE_ADDRESS');
  });

  it('rejects Fake-IP by default and allows when allowFakeIp is on', async () => {
    const blocked = new SafeUrlPolicy({ lookup: async () => [{ address: '198.18.0.47', family: 4 }] });
    await expect(blocked.assertAllowed('https://api.deepseek.com')).rejects.toThrow('URL_PRIVATE_ADDRESS');

    const allowed = new SafeUrlPolicy({
      allowFakeIp: true,
      lookup: async () => [{ address: '198.18.0.47', family: 4 }],
    });
    await expect(allowed.assertAllowed('https://api.deepseek.com')).resolves.toBeInstanceOf(URL);

    let dyn = false;
    const dynamic = new SafeUrlPolicy({
      allowFakeIp: () => dyn,
      lookup: async () => [{ address: '198.18.0.47', family: 4 }],
    });
    await expect(dynamic.assertAllowed('https://api.deepseek.com')).rejects.toThrow('URL_PRIVATE_ADDRESS');
    dyn = true;
    await expect(dynamic.assertAllowed('https://api.deepseek.com')).resolves.toBeInstanceOf(URL);
  });

  it('does not call the resolver again during HTTPS socket connect', async () => {
    const lookup = vi.fn()
      .mockResolvedValueOnce([{ address: '203.0.113.10', family: 4 }])
      .mockImplementation(() => Promise.resolve([{ address: '127.0.0.1', family: 4 }]));

    const policy = new SafeUrlPolicy({
      lookup,
      fetchImpl: vi.fn().mockResolvedValue(new Response('ok', { status: 200 })),
    });

    await policy.request('https://public.example', {}, {
      timeoutMs: 15_000, maxRedirects: 0, maxResponseBytes: 1024,
    });

    expect(lookup).toHaveBeenCalledTimes(1);
  });
});
