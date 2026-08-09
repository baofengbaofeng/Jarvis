import { MCP_FIELD_MAX } from '@jarvis/protocol';

export type McpTransportKind = 'stdio' | 'sse' | 'http';
export type SecretOrPlain = string | { secretRef: string };

export interface McpServerConfigJson {
  description?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, SecretOrPlain>;
  url?: string;
  headers?: Record<string, SecretOrPlain>;
  reconnectIntervalMs?: number;
  tlsVerify?: boolean;
  timeoutMs?: number;
  autoApprove?: string[];
  allowedTools?: string[] | null;
  blockedTools?: string[];
  agentIds?: string[];
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RECONNECT_MS = 3_000;

export function normalizeTransport(t: unknown): McpTransportKind {
  if (t === 'stdio' || t === 'sse' || t === 'http') return t;
  if (t === 'streamable-http') return 'http';
  throw new Error('MCP_TRANSPORT_INVALID');
}

function asPlainObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

function normalizeSecretOrPlain(value: unknown): SecretOrPlain | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const ref = (value as { secretRef?: unknown }).secretRef;
    if (typeof ref === 'string' && ref.trim()) return { secretRef: ref.trim() };
  }
  return undefined;
}

function normalizeSecretMap(raw: unknown, maxKeys: number, keyLen: number): Record<string, SecretOrPlain> | undefined {
  if (raw == null) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('MCP_ENV_INVALID');
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > maxKeys) throw new Error('MCP_ENV_TOO_MANY');
  const out: Record<string, SecretOrPlain> = {};
  for (const [k, v] of entries) {
    if (typeof k !== 'string' || !k.trim() || k.length > keyLen) throw new Error('MCP_ENV_KEY_INVALID');
    const normalized = normalizeSecretOrPlain(v);
    if (normalized === undefined) throw new Error('MCP_ENV_VALUE_INVALID');
    if (typeof normalized === 'string' && normalized.length > MCP_FIELD_MAX.envValue) {
      throw new Error('MCP_ENV_VALUE_TOO_LONG');
    }
    out[k.trim()] = normalized;
  }
  return out;
}

function normalizeStringList(raw: unknown, allowNull: boolean): string[] | null | undefined {
  if (raw === undefined) return undefined;
  if (allowNull && raw === null) return null;
  if (!Array.isArray(raw)) throw new Error('MCP_TOOL_LIST_INVALID');
  if (raw.length > MCP_FIELD_MAX.toolList) throw new Error('MCP_TOOL_LIST_TOO_LONG');
  return raw.map((item) => {
    if (typeof item !== 'string' || !item.trim()) throw new Error('MCP_TOOL_NAME_INVALID');
    const s = item.trim();
    if (s.length > MCP_FIELD_MAX.toolName) throw new Error('MCP_TOOL_NAME_TOO_LONG');
    return s;
  });
}

function normalizePositiveInt(raw: unknown, fallback: number): number {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 1) throw new Error('MCP_TIMEOUT_INVALID');
  return Math.floor(raw);
}

/**
 * Normalize a loose Claude-/UI-shaped MCP server config object into
 * `McpServerConfigJson`. Accepts `timeout` as an alias of `timeoutMs`.
 */
export function normalizeMcpServerConfig(raw: unknown): McpServerConfigJson {
  const o = asPlainObject(raw);
  const timeoutRaw = o.timeoutMs ?? o.timeout;
  const args = Array.isArray(o.args)
    ? o.args.map((a) => {
      if (typeof a !== 'string') throw new Error('MCP_ARGS_INVALID');
      return a;
    })
    : [];
  const agentIds = Array.isArray(o.agentIds)
    ? o.agentIds.map((a) => {
      if (typeof a !== 'string') throw new Error('MCP_AGENT_IDS_INVALID');
      return a;
    })
    : [];

  const cfg: McpServerConfigJson = {
    args,
    agentIds,
    timeoutMs: normalizePositiveInt(timeoutRaw, DEFAULT_TIMEOUT_MS),
    tlsVerify: o.tlsVerify === undefined ? true : Boolean(o.tlsVerify),
    reconnectIntervalMs: normalizePositiveInt(o.reconnectIntervalMs, DEFAULT_RECONNECT_MS),
  };

  if (typeof o.description === 'string') cfg.description = o.description;
  if (typeof o.command === 'string') cfg.command = o.command;
  if (typeof o.cwd === 'string') cfg.cwd = o.cwd;
  if (typeof o.url === 'string') cfg.url = o.url;
  if (o.env !== undefined) cfg.env = normalizeSecretMap(o.env, MCP_FIELD_MAX.envKeys, MCP_FIELD_MAX.envKeyLen);
  if (o.headers !== undefined) {
    try {
      cfg.headers = normalizeSecretMap(o.headers, MCP_FIELD_MAX.headerKeys, MCP_FIELD_MAX.headerKeyLen);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(msg.replace(/^MCP_ENV_/, 'MCP_HEADER_'));
    }
  }
  if (o.autoApprove !== undefined) cfg.autoApprove = normalizeStringList(o.autoApprove, false) as string[];
  if (o.allowedTools !== undefined) cfg.allowedTools = normalizeStringList(o.allowedTools, true);
  if (o.blockedTools !== undefined) cfg.blockedTools = normalizeStringList(o.blockedTools, false) as string[];

  return cfg;
}

function assertSecretMap(
  map: Record<string, SecretOrPlain> | undefined,
  maxKeys: number,
  keyLen: number,
  prefix: 'ENV' | 'HEADER',
): void {
  if (!map) return;
  const entries = Object.entries(map);
  if (entries.length > maxKeys) throw new Error(`MCP_${prefix}_TOO_MANY`);
  for (const [k, v] of entries) {
    if (!k || k.length > keyLen) throw new Error(`MCP_${prefix}_KEY_INVALID`);
    if (typeof v === 'string') {
      if (v.length > MCP_FIELD_MAX.envValue) throw new Error(`MCP_${prefix}_VALUE_TOO_LONG`);
    } else if (!v?.secretRef?.trim()) {
      throw new Error(`MCP_${prefix}_VALUE_INVALID`);
    }
  }
}

/** Throw `MCP_*` error codes when config is invalid for the given transport. */
export function assertMcpServerConfig(cfg: McpServerConfigJson, transport: McpTransportKind): void {
  if (cfg.description !== undefined && cfg.description.length > MCP_FIELD_MAX.description) {
    throw new Error('MCP_DESCRIPTION_TOO_LONG');
  }
  if (cfg.timeoutMs !== undefined) {
    if (!Number.isFinite(cfg.timeoutMs) || cfg.timeoutMs < 1 || cfg.timeoutMs > MCP_FIELD_MAX.timeoutMsMax) {
      throw new Error('MCP_TIMEOUT_INVALID');
    }
  }
  if (cfg.reconnectIntervalMs !== undefined) {
    if (!Number.isFinite(cfg.reconnectIntervalMs) || cfg.reconnectIntervalMs < 1 || cfg.reconnectIntervalMs > MCP_FIELD_MAX.timeoutMsMax) {
      throw new Error('MCP_RECONNECT_INVALID');
    }
  }

  const argsJoined = (cfg.args ?? []).join(' ');
  if (argsJoined.length > MCP_FIELD_MAX.args) throw new Error('MCP_ARGS_TOO_LONG');

  assertSecretMap(cfg.env, MCP_FIELD_MAX.envKeys, MCP_FIELD_MAX.envKeyLen, 'ENV');
  assertSecretMap(cfg.headers, MCP_FIELD_MAX.headerKeys, MCP_FIELD_MAX.headerKeyLen, 'HEADER');

  if (transport === 'stdio') {
    const command = (cfg.command ?? '').trim();
    if (!command) throw new Error('MCP_COMMAND_REQUIRED');
    if (command.length > MCP_FIELD_MAX.command) throw new Error('MCP_COMMAND_TOO_LONG');
    if (cfg.cwd !== undefined && cfg.cwd.length > MCP_FIELD_MAX.cwd) throw new Error('MCP_CWD_TOO_LONG');
  } else {
    const url = (cfg.url ?? '').trim();
    if (!url) throw new Error('MCP_URL_REQUIRED');
    if (url.length > MCP_FIELD_MAX.url) throw new Error('MCP_URL_TOO_LONG');
  }
}
