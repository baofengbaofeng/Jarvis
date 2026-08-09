import { describe, expect, it } from 'vitest';
import { assertMcpRemoteUrl, isLoopbackHostname } from './mcp-url';

describe('assertMcpRemoteUrl', () => {
  it('allows loopback http without SafeUrlPolicy', async () => {
    const u = await assertMcpRemoteUrl('http://127.0.0.1:9000/mcp/sse');
    expect(u.href).toContain('127.0.0.1');
    expect(isLoopbackHostname('localhost')).toBe(true);
  });

  it('rejects non-loopback http', async () => {
    await expect(assertMcpRemoteUrl('http://evil.example/sse')).rejects.toThrow('MCP_URL_HTTPS_REQUIRED');
  });

  it('runs SafeUrlPolicy for public https', async () => {
    await expect(
      assertMcpRemoteUrl('https://mcp.example/sse', async () => {
        throw new Error('URL_PRIVATE_ADDRESS');
      }),
    ).rejects.toThrow('URL_PRIVATE_ADDRESS');
  });
});
