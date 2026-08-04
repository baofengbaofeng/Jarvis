export interface ProxyConfig { mode: 'none' | 'system' | 'custom'; httpUrl?: string; socksUrl?: string }

export function resolveProxyConfig(raw: unknown): ProxyConfig {
  if (!raw || typeof raw !== 'object') return { mode: 'none' };
  const r = raw as { mode?: string; httpUrl?: string; socksUrl?: string };
  if (r.mode !== 'system' && r.mode !== 'custom') return { mode: 'none' };
  return { mode: r.mode, httpUrl: r.httpUrl, socksUrl: r.socksUrl };
}
