import {
  McpClient,
  createMcpClient,
  createSseTransport,
  createStreamableHttpTransport,
  mapSecretPlainRecord,
  type McpServerConfigJson,
  type McpTransportKind,
  type SecretOrPlain,
  type SpawnImpl,
} from '@jarvis/core';
import { assertMcpCommand } from './mcpCommand';
import { assertMcpRemoteUrl } from './mcp-url';

export interface McpSecretStore {
  get(key: string): Promise<string | null | undefined>;
}

export interface OpenMcpClientDeps {
  spawnImpl?: SpawnImpl;
  secrets?: McpSecretStore;
  globalEnv?: Record<string, SecretOrPlain>;
  fetchImpl?: typeof fetch;
  assertAllowedUrl?: (url: string) => Promise<void>;
}

async function resolveMaps(
  secrets: McpSecretStore | undefined,
  globalEnv: OpenMcpClientDeps['globalEnv'],
  cfg: McpServerConfigJson,
): Promise<{ env: Record<string, string>; headers: Record<string, string> }> {
  const cache = new Map<string, string | undefined>();
  const collect = (m?: Record<string, SecretOrPlain>) => {
    if (!m) return;
    for (const v of Object.values(m)) {
      if (v && typeof v === 'object' && 'secretRef' in v) {
        cache.set(v.secretRef, undefined);
      }
    }
  };
  collect(globalEnv);
  collect(cfg.env);
  collect(cfg.headers);
  for (const ref of cache.keys()) {
    cache.set(ref, (await secrets?.get(ref)) ?? undefined);
  }
  const resolver = (ref: string) => cache.get(ref);
  return {
    env: {
      ...mapSecretPlainRecord(globalEnv, resolver),
      ...mapSecretPlainRecord(cfg.env, resolver),
    },
    headers: mapSecretPlainRecord(cfg.headers, resolver),
  };
}

export async function openMcpClientForServer(
  row: { name: string; transport: string; config: McpServerConfigJson },
  deps: OpenMcpClientDeps = {},
): Promise<McpClient> {
  const transport = row.transport as McpTransportKind;
  const cfg = row.config;
  const { env, headers } = await resolveMaps(deps.secrets, deps.globalEnv, cfg);
  const timeoutMs = cfg.timeoutMs;

  if (transport === 'stdio') {
    assertMcpCommand(cfg.command ?? '', cfg.args ?? []);
    return createMcpClient(cfg.command ?? '', cfg.args ?? [], row.name, {
      spawnImpl: deps.spawnImpl,
      cwd: cfg.cwd,
      env,
      requestTimeoutMs: timeoutMs,
    });
  }

  await assertMcpRemoteUrl(cfg.url ?? '', deps.assertAllowedUrl);
  const client = new McpClient({ requestTimeoutMs: timeoutMs }, row.name);
  const onError = (err: Error) => { client.rejectAllPending(`McpClient(${row.name}): ${err.message}`); };
  if (transport === 'sse') {
    client.attach(createSseTransport({ url: cfg.url!, headers, fetchImpl: deps.fetchImpl, onError }));
  } else {
    client.attach(createStreamableHttpTransport({
      url: cfg.url!,
      headers,
      fetchImpl: deps.fetchImpl,
      tlsVerify: cfg.tlsVerify,
      onError,
    }));
  }
  return client;
}
