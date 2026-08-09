/** MCP remote URL policy: allow loopback http(s); otherwise HTTPS + optional SafeUrlPolicy. */

export function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1';
}

export async function assertMcpRemoteUrl(
  raw: string,
  assertAllowed?: (url: string) => Promise<void>,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('MCP_URL_INVALID');
  }
  if (isLoopbackHostname(url.hostname) && (url.protocol === 'http:' || url.protocol === 'https:')) {
    return url;
  }
  if (url.protocol !== 'https:') throw new Error('MCP_URL_HTTPS_REQUIRED');
  if (assertAllowed) await assertAllowed(url.href);
  return url;
}
