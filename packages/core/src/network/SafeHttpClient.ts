export interface SafeFetchLimits {
  signal?: AbortSignal;
  timeoutMs: number;
  maxRedirects: number;
  maxResponseBytes: number;
}

export interface SafeHttpClient {
  request(url: string, init: RequestInit | undefined, limits: SafeFetchLimits): Promise<Response>;
}

/** Returns true when the address must be blocked for outbound HTTPS (SSRF). */
export function isRestrictedAddress(address: string, opts: { allowLoopback?: boolean } = {}): boolean {
  const allowLoopback = opts.allowLoopback ?? false;

  // IPv4-mapped IPv6: ::ffff:x.x.x.x
  const v4Mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4Mapped) return isRestrictedIPv4(v4Mapped[1], allowLoopback);

  if (address.includes(':')) return isRestrictedIPv6(address, allowLoopback);
  return isRestrictedIPv4(address, allowLoopback);
}

function parseIPv4(octets: string): number {
  const parts = octets.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) return -1;
  return ((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!;
}

function inRange(ip: number, base: string, bits: number): boolean {
  const b = parseIPv4(base);
  if (b < 0 || ip < 0) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ip & mask) === (b & mask);
}

function isRestrictedIPv4(address: string, allowLoopback: boolean): boolean {
  const ip = parseIPv4(address);
  if (ip < 0) return true;

  if (!allowLoopback && inRange(ip, '127.0.0.0', 8)) return true;
  if (inRange(ip, '0.0.0.0', 8)) return true;
  if (inRange(ip, '10.0.0.0', 8)) return true;
  if (inRange(ip, '100.64.0.0', 10)) return true;
  if (inRange(ip, '169.254.0.0', 16)) return true;
  if (inRange(ip, '172.16.0.0', 12)) return true;
  if (inRange(ip, '192.0.0.0', 24)) return true;
  if (inRange(ip, '192.168.0.0', 16)) return true;
  if (inRange(ip, '198.18.0.0', 15)) return true;
  if (inRange(ip, '224.0.0.0', 4)) return true;
  if (inRange(ip, '240.0.0.0', 4)) return true;
  return false;
}

function expandIPv6(address: string): bigint | null {
  const lower = address.toLowerCase();
  if (!/^[0-9a-f:]+$/i.test(lower)) return null;

  let parts: string[];
  if (lower.includes('::')) {
    const [head, tail] = lower.split('::');
    const h = head ? head.split(':').filter(Boolean) : [];
    const t = tail ? tail.split(':').filter(Boolean) : [];
    const missing = 8 - h.length - t.length;
    if (missing < 0) return null;
    parts = [...h, ...Array(missing).fill('0'), ...t];
  } else {
    parts = lower.split(':');
  }
  if (parts.length !== 8) return null;

  let value = 0n;
  for (const p of parts) {
    const n = BigInt(`0x${p || '0'}`);
    if (n > 0xffffn) return null;
    value = (value << 16n) + n;
  }
  return value;
}

function ipv6PrefixMatch(value: bigint, prefixBits: number, prefixValue: bigint): boolean {
  if (prefixBits === 0) return true;
  const shift = 128n - BigInt(prefixBits);
  return (value >> shift) === (prefixValue >> shift);
}

function isRestrictedIPv6(address: string, allowLoopback: boolean): boolean {
  const value = expandIPv6(address);
  if (value === null) return true;

  if (value === 0n) return true; // ::/128
  if (!allowLoopback && value === 1n) return true; // ::1/128

  const fc00 = 0xfc00n << 112n;
  if (ipv6PrefixMatch(value, 7, fc00)) return true; // fc00::/7

  const fe80 = 0xfe80n << 112n;
  if (ipv6PrefixMatch(value, 10, fe80)) return true; // fe80::/10

  const ff00 = 0xff00n << 112n;
  if (ipv6PrefixMatch(value, 8, ff00)) return true; // ff00::/8

  // IPv4-mapped ::ffff:0:0/96
  const mappedBase = 0xffffn << 96n;
  if ((value & (0xffffn << 96n)) === mappedBase) {
    const v4 = Number(value & 0xffffffffn);
    const octets = [(v4 >>> 24) & 255, (v4 >>> 16) & 255, (v4 >>> 8) & 255, v4 & 255].join('.');
    return isRestrictedIPv4(octets, allowLoopback);
  }

  return false;
}
