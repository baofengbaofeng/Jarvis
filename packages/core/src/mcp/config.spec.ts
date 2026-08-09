import { describe, expect, it } from 'vitest';
import { MCP_FIELD_MAX } from '@jarvis/protocol';
import {
  assertMcpServerConfig,
  normalizeMcpServerConfig,
  normalizeTransport,
} from './config';

describe('normalizeTransport', () => {
  it('maps streamable-http to storage transport http', () => {
    expect(normalizeTransport('streamable-http')).toBe('http');
    expect(normalizeTransport('http')).toBe('http');
    expect(normalizeTransport('sse')).toBe('sse');
    expect(normalizeTransport('stdio')).toBe('stdio');
  });

  it('rejects unknown transports', () => {
    expect(() => normalizeTransport('ws')).toThrow('MCP_TRANSPORT_INVALID');
  });
});

describe('normalizeMcpServerConfig', () => {
  it('coerces timeout alias to timeoutMs and applies defaults', () => {
    const cfg = normalizeMcpServerConfig({ timeout: 45_000 });
    expect(cfg.timeoutMs).toBe(45_000);
    expect(cfg.tlsVerify).toBe(true);
    expect(cfg.reconnectIntervalMs).toBe(3_000);
    expect(cfg.args).toEqual([]);
    expect(cfg.agentIds).toEqual([]);
  });

  it('preserves secretRef env entries', () => {
    const cfg = normalizeMcpServerConfig({
      env: { GITHUB_TOKEN: { secretRef: 'mcp.x.env.GITHUB_TOKEN' } },
    });
    expect(cfg.env).toEqual({ GITHUB_TOKEN: { secretRef: 'mcp.x.env.GITHUB_TOKEN' } });
  });
});

describe('assertMcpServerConfig', () => {
  it('rejects empty stdio command', () => {
    const cfg = normalizeMcpServerConfig({ command: '  ' });
    expect(() => assertMcpServerConfig(cfg, 'stdio')).toThrow('MCP_COMMAND_REQUIRED');
  });

  it('rejects oversized remote url', () => {
    const cfg = normalizeMcpServerConfig({ url: 'https://x.example/' + 'a'.repeat(MCP_FIELD_MAX.url) });
    expect(() => assertMcpServerConfig(cfg, 'sse')).toThrow('MCP_URL_TOO_LONG');
  });

  it('accepts a minimal valid stdio config', () => {
    const cfg = normalizeMcpServerConfig({ command: 'npx', args: ['-y', 'pkg'] });
    expect(() => assertMcpServerConfig(cfg, 'stdio')).not.toThrow();
  });

  it('requires url for sse/http', () => {
    const cfg = normalizeMcpServerConfig({});
    expect(() => assertMcpServerConfig(cfg, 'http')).toThrow('MCP_URL_REQUIRED');
  });
});

describe('claude mcp import/export', () => {
  it('round-trips and redacts plaintext secrets on export', async () => {
    const { toClaudeMcpExport, fromClaudeMcpImport, MINIMAL_MCP_SAMPLE } = await import('./config');
    const exported = toClaudeMcpExport([
      {
        name: 'fs',
        transport: 'stdio',
        enabled: true,
        config: normalizeMcpServerConfig({
          command: 'npx',
          args: ['-y', 'pkg'],
          env: { TOKEN: 'plaintext-secret' },
        }),
      },
    ]);
    expect(exported.mcpServers.fs?.env?.TOKEN).toEqual({ secretRef: 'export.redacted.TOKEN' });
    const imported = fromClaudeMcpImport(MINIMAL_MCP_SAMPLE);
    expect(imported.servers.map((s) => s.key).sort()).toEqual(['filesystem', 'github']);
  });
});
