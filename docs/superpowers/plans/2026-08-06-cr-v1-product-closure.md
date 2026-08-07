# JARVIS 1.0.0-Preview 产品能力闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 CR 报告 REQ-02、REQ-03、REQ-04、REQ-07、REQ-08，使远程 MCP、URL Skill、Provider 指南、Canvas 任务产物和 Agent 版本历史都能从真实产品入口完成闭环。

**Architecture:** `packages/core` 继续拥有唯一的 MCP Client/transport 和 Skill 解析逻辑；Electron main 负责 SQLite、SecureStorage、文件写入和 IPC，renderer 只提交表单并投影视图。远程 MCP 与 URL Skill 共同消费安全信任边界 plan 提供的 `SafeHttpClient`，不各自实现 URL/DNS/重定向策略；Canvas 与 VersionHistory 只补真实路由和状态刷新，不复制已有 artifact/version 数据层。

**Tech Stack:** TypeScript 5、Node 20 Fetch/ReadableStream、Electron IPC、better-sqlite3、SecureStorage、React 19、react-router-dom、Zustand、Vitest/RTL、Node test runner。

## Global Constraints

- 覆盖唯一 CR：REQ-02（Task 1–2）、REQ-03（Task 3）、REQ-04（Task 4）、REQ-07（Task 5）、REQ-08（Task 6）。
- 执行顺序依赖安全信任边界 plan 先提供 `packages/core/src/network/SafeHttpClient.ts`：`SafeHttpClient.request(url, init, limits): Promise<Response>`；`limits` 精确为 `{ signal?: AbortSignal; timeoutMs: number; maxRedirects: number; maxResponseBytes: number }`，实现负责仅允许 HTTPS、拒绝 URL credentials、每次重定向重新校验并在 DNS 解析后拒绝 loopback/private/link-local 地址。Task 1 与 Task 3 只注入并调用该接口。
- Task 1 还依赖 Engine plan 的 MCP lifecycle Task：统一契约已经包含 async `send`、`onMessage`、`onError`、`onClose`、request timeout/AbortSignal、1 MiB frame gate 和 pending `finish/failAll`。本计划只增加远程 transport，不得退回 `readline`、删除 `onClose` 或重写为无 timeout 的简化 McpClient。
- `AgentEngine`、REACT loop、`ModelRouter`、`McpClient` 只在 `packages/core` 实现；Go 不增加 MCP Client。
- Renderer 只能从 `@jarvis/core/renderer` 导入纯模块；MCP/Skill 网络与文件模块不得加入 `renderer.ts`。
- `mcp_servers.config_json` 只保存非敏感配置和 `secretHeadersRef`；`Authorization`、`Proxy-Authorization`、`Cookie`、`X-API-Key` 以及名称匹配 `/token|secret|key|authorization|cookie/i` 的 header 值只能进入 `SecureStorage`。
- 不修改 migration v1–v12；本计划无需 schema 变更，继续使用 `mcp_servers.config_json`。
- 所有 IPC 使用 `IpcChannel` 常量，返回 `{ ok: true, ... } | { ok: false, code, error }`；`mcp.test` 只接受已持久化 server ID。
- URL Skill 最大响应 256 KiB，仅接受 `text/markdown`、`text/plain` 或 `application/octet-stream`，名称必须匹配 `^[a-z0-9][a-z0-9._-]{0,63}$` 且不得包含 `..`。
- 新 UI 和错误码必须在 `packages/i18n/locales/zh-CN/common.json` 与 `en/common.json` 对称增加。
- 每个 Task 只暂存其列出的文件；提交前运行 `git diff --cached --check`，不得夹带当前工作树已有修改。

## File Structure

- `packages/core/src/mcp/transport.ts`：统一 transport 契约与 stdio 实现。
- `packages/core/src/mcp/http-transport.ts`：SSE 与 Streamable HTTP 会话、SSE 帧解析。
- `packages/core/src/mcp/McpClient.ts`：transport-neutral JSON-RPC client。
- `apps/desktop/src/main/ipc/mcp.ts`：MCP 配置、secret header 拆分、test/register。
- `packages/core/src/skills/SkillsLoader.ts`：安全名称与 URL 下载后的纯解析。
- `apps/desktop/src/main/ipc/skills.ts`：URL import 冲突策略、落盘与数据库事务。
- `scripts/docs-links.mjs`：Provider 指南本地链接检查。
- `apps/desktop/src/renderer/src/pages/CanvasPage.tsx`：路由/active taskId 解析。
- `apps/desktop/src/renderer/src/pages/AgentDetailPage.tsx`：挂载 VersionHistory 并刷新表单。

---

### Task 1: MCP 统一 stdio/SSE/Streamable HTTP Transport

**Files:**
- Modify: `packages/core/src/mcp/transport.ts`
- Create: `packages/core/src/mcp/http-transport.ts`
- Create: `packages/core/src/mcp/transport.spec.ts`
- Modify: `packages/core/src/mcp/McpClient.ts`
- Modify: `packages/core/src/mcp/McpClient.spec.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `SafeHttpClient.request(url, init, limits): Promise<Response>`。
- Produces:
  - `McpTransportConfig = { kind:'stdio'; command:string; args:string[] } | { kind:'sse'; url:string; headers:Record<string,string> } | { kind:'streamable-http'; url:string; headers:Record<string,string> }`
  - `McpTransport { send(message, signal?): Promise<void>; onMessage(cb): () => void; onError(cb): () => void; onClose(cb): () => void; close(): Promise<void> }`
  - `createMcpTransport(config, deps): Promise<McpTransport>`
  - `createMcpClient(config, serverName, deps): Promise<McpClient>`
  - `McpClient.initialize/listTools/callTool` 接受可选 `AbortSignal`。

- [ ] **Step 1: 写三个 transport 的失败测试**

`packages/core/src/mcp/transport.spec.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { createMcpTransport } from './transport';

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } });

describe('createMcpTransport', () => {
  it('writes newline-delimited JSON over stdio', async () => {
    const stdout = new PassThrough();
    const write = vi.fn();
    const transport = await createMcpTransport(
      { kind: 'stdio', command: 'node', args: ['server.js'] },
      { spawnImpl: () => ({ stdout, stdin: { write, end() {} }, kill() {} }) as never },
    );
    await transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(write).toHaveBeenCalledWith('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n');
  });

  it('uses the SSE endpoint event for JSON-RPC POST and emits message events', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('event: endpoint\ndata: https://mcp.example/messages\n\n'));
        c.enqueue(new TextEncoder().encode('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n\n'));
      },
    });
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    const transport = await createMcpTransport(
      { kind: 'sse', url: 'https://mcp.example/sse', headers: { Accept: 'text/event-stream' } },
      { http: { request } as never },
    );
    const messages: unknown[] = [];
    transport.onMessage(m => messages.push(m));
    await transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    await vi.waitFor(() => expect(messages).toHaveLength(1));
    expect(request.mock.calls[1][0]).toBe('https://mcp.example/messages');
  });

  it('keeps Mcp-Session-Id and parses Streamable HTTP SSE responses', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(json({ jsonrpc: '2.0', id: 1, result: {} }, { 'Mcp-Session-Id': 'session-1' }))
      .mockResolvedValueOnce(new Response(
        'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"tools":[]}}\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      ));
    const transport = await createMcpTransport(
      { kind: 'streamable-http', url: 'https://mcp.example/mcp', headers: {} },
      { http: { request } as never },
    );
    const messages: Array<Record<string, unknown>> = [];
    transport.onMessage(m => messages.push(m));
    await transport.send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    await transport.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(request.mock.calls[1][1].headers['Mcp-Session-Id']).toBe('session-1');
    expect(messages.map(m => m.id)).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: 运行失败测试**

Run: `cd packages/core && pnpm vitest run src/mcp/transport.spec.ts`

Expected: FAIL，`createMcpTransport` 与远程 transport 尚不存在。

- [ ] **Step 3: 实现统一 transport 与 SSE parser**

`packages/core/src/mcp/transport.ts` 保留 Engine plan 已实现的 byte-buffer stdio transport、frame gate 和终止通知，只扩展 config union 与工厂分支：

```ts
import type { SafeHttpClient } from '../network/SafeHttpClient';
import { createLegacySseTransport, createStreamableHttpTransport } from './http-transport';

export type McpMessage = Record<string, unknown>;
export type McpTransportConfig =
  | { kind: 'stdio'; command: string; args: string[] }
  | { kind: 'sse'; url: string; headers: Record<string, string> }
  | { kind: 'streamable-http'; url: string; headers: Record<string, string> };
export interface McpTransport {
  send(message: McpMessage, signal?: AbortSignal): Promise<void>;
  onMessage(cb: (message: McpMessage) => void): () => void;
  onError(cb: (error: Error) => void): () => void;
  onClose(cb: (error: Error) => void): () => void;
  close(): Promise<void>;
}
export interface McpTransportDeps { spawnImpl?: SpawnImpl; http?: SafeHttpClient }

export async function createMcpTransport(config: McpTransportConfig, deps: McpTransportDeps = {}): Promise<McpTransport> {
  if (config.kind === 'sse') {
    if (!deps.http) throw new Error('safe HTTP client required');
    return createLegacySseTransport(config, deps.http);
  }
  if (config.kind === 'streamable-http') {
    if (!deps.http) throw new Error('safe HTTP client required');
    return createStreamableHttpTransport(config, deps.http);
  }
  return createBoundedStdioTransport(config.command, config.args, deps.spawnImpl);
}
```

`packages/core/src/mcp/http-transport.ts` 的帧解析与两个 transport：

```ts
import type { SafeHttpClient } from '../network/SafeHttpClient';
import type { McpMessage, McpTransport } from './transport';

const LIMITS = { timeoutMs: 30_000, maxRedirects: 3, maxResponseBytes: 1_048_576 };
type Sink = {
  message: Set<(m: McpMessage) => void>;
  error: Set<(e: Error) => void>;
  close: Set<(e: Error) => void>;
};

function emitJson(data: string, sink: Sink): void {
  try { sink.message.forEach(cb => cb(JSON.parse(data) as McpMessage)); }
  catch { sink.error.forEach(cb => cb(new Error('invalid MCP SSE JSON'))); }
}
async function consumeSse(response: Response, sink: Sink, onEvent?: (event: string, data: string) => void): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('MCP SSE response has no body');
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
    let split: number;
    while ((split = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, split); buffer = buffer.slice(split + 2);
      let event = 'message'; const data: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      const joined = data.join('\n');
      if (joined) onEvent ? onEvent(event, joined) : emitJson(joined, sink);
    }
    if (done) break;
  }
}
function listeners(sink: Sink) {
  return {
    onMessage(cb: (m: McpMessage) => void) { sink.message.add(cb); return () => sink.message.delete(cb); },
    onError(cb: (e: Error) => void) { sink.error.add(cb); return () => sink.error.delete(cb); },
    onClose(cb: (e: Error) => void) { sink.close.add(cb); return () => sink.close.delete(cb); },
  };
}

export async function createLegacySseTransport(
  config: { url: string; headers: Record<string, string> },
  http: SafeHttpClient,
): Promise<McpTransport> {
  const sink: Sink = { message: new Set(), error: new Set(), close: new Set() };
  const lifetime = new AbortController();
  let endpoint = '';
  const ready = new Promise<void>(async (resolve, reject) => {
    try {
      const response = await http.request(
        config.url,
        { method: 'GET', headers: config.headers, signal: lifetime.signal },
        { ...LIMITS, signal: lifetime.signal },
      );
      await consumeSse(response, sink, (event, data) => {
        if (event === 'endpoint') { endpoint = new URL(data, config.url).toString(); resolve(); }
        if (event === 'message') emitJson(data, sink);
      });
    } catch (e) { reject(e); }
  });
  return {
    ...listeners(sink),
    async send(message, signal) {
      await ready;
      await http.request(endpoint, {
        method: 'POST', signal, headers: { ...config.headers, 'content-type': 'application/json' },
        body: JSON.stringify(message),
      }, { ...LIMITS, signal });
    },
    async close() {
      if (lifetime.signal.aborted) return;
      lifetime.abort(new DOMException('MCP SSE closed', 'AbortError'));
      const error = new Error('MCP SSE closed');
      sink.close.forEach(cb => cb(error));
    },
  };
}

export async function createStreamableHttpTransport(
  config: { url: string; headers: Record<string, string> },
  http: SafeHttpClient,
): Promise<McpTransport> {
  const sink: Sink = { message: new Set(), error: new Set(), close: new Set() };
  let sessionId: string | undefined;
  return {
    ...listeners(sink),
    async send(message, signal) {
      const response = await http.request(config.url, {
        method: 'POST', signal,
        headers: {
          ...config.headers, Accept: 'application/json, text/event-stream',
          'content-type': 'application/json', ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
        },
        body: JSON.stringify(message),
      }, { ...LIMITS, signal });
      sessionId = response.headers.get('Mcp-Session-Id') ?? sessionId;
      if (response.headers.get('content-type')?.includes('text/event-stream')) await consumeSse(response, sink);
      else emitJson(await response.text(), sink);
    },
    async close() {
      if (sessionId) await http.request(config.url, {
        method: 'DELETE', headers: { ...config.headers, 'Mcp-Session-Id': sessionId },
      }, LIMITS);
      const error = new Error('MCP HTTP closed');
      sink.close.forEach(cb => cb(error));
    },
  };
}
```

Legacy SSE 的 background consume reject 必须调用 `sink.error` 并触发一次 `sink.close`；`close()` abort 后该预期 AbortError 不得重复上报。Streamable HTTP 的 DELETE 也受 10 秒 timeout/AbortSignal 控制，失败仍须本地关闭并通知 client。

- [ ] **Step 4: 保持 McpClient 生命周期语义并扩展 async factory**

不得替换 Engine plan 的 pending/timer/abort `finish/failAll`。只把 factory 从 stdio 参数改为 transport config，并继续让 constructor 订阅 `onMessage/onError/onClose`：

```ts
export async function createMcpClient(
  config: McpTransportConfig, serverName: string, deps: McpTransportDeps = {},
): Promise<McpClient> {
  return new McpClient(await createMcpTransport(config, deps), serverName);
}
```

更新 `McpClient.spec.ts`，以注入的内存 `McpTransport` 分别驱动 initialize/list/call，并断言三种 config 创建出的 client 都使用相同 JSON-RPC 方法；远程 send reject、SSE lifetime close 和 HTTP close 必须令 `debugPendingCount()` 回到 0。不要再通过空 command 触发 lazy stdio。

- [ ] **Step 5: 验证 core**

Run: `cd packages/core && pnpm vitest run src/mcp/McpClient.spec.ts src/mcp/transport.spec.ts && pnpm typecheck`

Expected: 两个 spec PASS，core typecheck PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/mcp/transport.ts packages/core/src/mcp/http-transport.ts packages/core/src/mcp/transport.spec.ts packages/core/src/mcp/McpClient.ts packages/core/src/mcp/McpClient.spec.ts packages/core/src/index.ts
git diff --cached --check
git commit -m "feat: unify MCP stdio and remote transports"
```

---

### Task 2: MCP Secret Headers、IPC 与完整设置 UI

**Files:**
- Modify: `apps/desktop/src/main/ipc/mcp.ts`
- Modify: `apps/desktop/src/main/ipc/mcp.spec.ts`
- Modify: `apps/desktop/src/main/ipc/register-agents-ipc.ts`
- Modify: `apps/desktop/src/main/ipc/IpcRouter.ts`
- Modify: `apps/desktop/src/renderer/src/pages/settings/McpSettingsPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/settings/McpSettingsPage.spec.tsx`
- Modify: `packages/protocol/src/ipc-channels.ts`
- Modify: `packages/protocol/src/ipc-allowlist.ts`
- Modify: `packages/i18n/locales/zh-CN/common.json`
- Modify: `packages/i18n/locales/en/common.json`

**Interfaces:**
- Consumes: Task 1 `McpTransportConfig/createMcpClient`、`SecureStorage`、`SafeHttpClient`。
- Produces:
  - `McpServerInput { name; transport:'stdio'|'sse'|'http'; command?; args?; url?; headers?; agentIds }`
  - `McpServerRow.config { command?; args?; url?; publicHeaders; secretHeadersRef?; agentIds }`
  - `createMcpStore(db, secrets)` 的 async `create/remove/resolveConfig`。
  - IPC `mcp.list/create/delete/test`；`mcp.test` payload 为 `{ id: string }`。

- [ ] **Step 1: 写 secret 不落盘及三 transport 注册失败测试**

在 `apps/desktop/src/main/ipc/mcp.spec.ts` 增加：

```ts
it('stores sensitive remote headers only in SecureStorage', async () => {
  const saved = new Map<string, string>();
  const secrets = {
    async set(k: string, v: string) { saved.set(k, v); },
    async get(k: string) { return saved.get(k) ?? null; },
    async delete(k: string) { saved.delete(k); },
  };
  const store = createMcpStore(db, secrets);
  const row = await store.create({
    name: 'remote', transport: 'http', url: 'https://mcp.example/mcp',
    headers: { Authorization: 'Bearer top-secret', 'X-Tenant': 'acme' }, agentIds: ['a1'],
  });
  const raw = db.prepare('SELECT config_json FROM mcp_servers WHERE id = ?').get(row.id) as { config_json: string };
  expect(raw.config_json).not.toContain('top-secret');
  expect(raw.config_json).toContain('X-Tenant');
  expect(saved.get(`mcp:${row.id}:headers`)).toContain('top-secret');
  expect(await store.resolveConfig(row.id)).toMatchObject({
    kind: 'streamable-http', url: 'https://mcp.example/mcp',
    headers: { Authorization: 'Bearer top-secret', 'X-Tenant': 'acme' },
  });
});

it.each(['stdio', 'sse', 'http'] as const)('tests persisted %s configuration by id', async transport => {
  const created = await store.create(transport === 'stdio'
    ? { name: transport, transport, command: 'node', args: ['server.js'], agentIds: [] }
    : { name: transport, transport, url: `https://mcp.example/${transport}`, headers: {}, agentIds: [] });
  const result = await testMcpServer(created.id, store, { createClient });
  expect(result).toEqual({ ok: true, tools: ['read'] });
  expect(createClient).toHaveBeenCalledWith(expect.objectContaining({
    kind: transport === 'http' ? 'streamable-http' : transport,
  }), transport, expect.anything());
});
```

- [ ] **Step 2: 运行失败测试**

Run: `cd apps/desktop && pnpm vitest run src/main/ipc/mcp.spec.ts`

Expected: FAIL，store 尚未注入 secrets，远程 transport 仍被拒绝。

- [ ] **Step 3: 实现配置拆分和按 ID 测试**

在 `mcp.ts` 使用以下核心函数：

```ts
const SENSITIVE_HEADER = /token|secret|key|authorization|cookie/i;
const splitHeaders = (headers: Record<string, string> = {}) =>
  Object.entries(headers).reduce((out, [name, value]) => {
    out[SENSITIVE_HEADER.test(name) ? 'secret' : 'public'][name] = value;
    return out;
  }, { public: {} as Record<string, string>, secret: {} as Record<string, string> });

export function createMcpStore(
  db: Database.Database,
  secrets: Pick<SecureStorage, 'set' | 'get' | 'delete'>,
) {
  const getRow = (id: string) => db.prepare(
    'SELECT id, name, transport, config_json FROM mcp_servers WHERE id = ?',
  ).get(id) as { id: string; name: string; transport: 'stdio'|'sse'|'http'; config_json: string } | undefined;
  return {
    list(): McpServerRow[] {
      return (db.prepare('SELECT * FROM mcp_servers ORDER BY created_at').all() as Record<string, unknown>[])
        .map(r => ({ id: r.id as string, name: r.name as string, transport: r.transport as McpServerRow['transport'], config: JSON.parse(r.config_json as string) }));
    },
    async create(input: McpServerInput): Promise<McpServerRow> {
      const id = randomUUID();
      const { public: publicHeaders, secret } = splitHeaders(input.headers);
      const secretHeadersRef = Object.keys(secret).length ? `mcp:${id}:headers` : undefined;
      if (secretHeadersRef) await secrets.set(secretHeadersRef, JSON.stringify(secret));
      const config = { command: input.command, args: input.args ?? [], url: input.url, publicHeaders, secretHeadersRef, agentIds: input.agentIds ?? [] };
      try {
        db.prepare('INSERT INTO mcp_servers (id,name,transport,config_json,created_at) VALUES (?,?,?,?,?)')
          .run(id, input.name, input.transport, JSON.stringify(config), new Date().toISOString());
      } catch (error) {
        if (secretHeadersRef) await secrets.delete(secretHeadersRef);
        throw error;
      }
      return this.list().find(row => row.id === id)!;
    },
    async resolveConfig(id: string): Promise<McpTransportConfig> {
      const row = getRow(id);
      if (!row) throw new Error('MCP_SERVER_NOT_FOUND');
      const cfg = JSON.parse(row.config_json) as McpServerRow['config'];
      const secret = cfg.secretHeadersRef ? JSON.parse(await secrets.get(cfg.secretHeadersRef) ?? '{}') : {};
      if (row.transport === 'stdio') return { kind: 'stdio', command: cfg.command ?? '', args: cfg.args ?? [] };
      return { kind: row.transport === 'sse' ? 'sse' : 'streamable-http', url: cfg.url ?? '', headers: { ...cfg.publicHeaders, ...secret } };
    },
    async remove(id: string): Promise<void> {
      const row = getRow(id); const cfg = row ? JSON.parse(row.config_json) as McpServerRow['config'] : undefined;
      db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
      if (cfg?.secretHeadersRef) await secrets.delete(cfg.secretHeadersRef);
      await closeMcpClient(id);
    },
  };
}

export async function testMcpServer(
  id: string,
  store: Pick<ReturnType<typeof createMcpStore>, 'resolveConfig'>,
  deps: McpRegistrationDeps,
): Promise<{ ok: boolean; tools: string[]; error?: string }> {
  let client: McpClient | undefined;
  try {
    const config = await store.resolveConfig(id);
    client = await deps.createClient(config, id, deps.transportDeps);
    await client.initialize();
    return { ok: true, tools: (await client.listTools()).map(t => t.name) };
  } catch (e) {
    return { ok: false, tools: [], error: e instanceof Error ? e.message : String(e) };
  } finally { await client?.close(); }
}
```

`registerAgentMcpTools` 对每个绑定 row 调 `store.resolveConfig(s.id)`，不再按 transport 跳过；cache key 仍为 server ID。

增加两个补偿测试：DB insert 失败后 `secretHeadersRef` 已删除；DB delete 失败时 secret 仍存在。Header name 必须通过 HTTP token 正则并拒绝 CR/LF、`Host`、`Content-Length`、`Connection`，不能让 renderer 覆盖 transport-managed headers。

- [ ] **Step 4: 接线 SecureStorage 和协议常量**

在 `IpcChannel` 增加 `mcpList/mcpCreate/mcpDelete/mcpTest`，allowlist 全部引用常量。`IpcRouter.registerAll` 将同一个 `secrets` 和安全 HTTP client 传给：

```ts
registerAgentsIpc((ch, h) => this.register(ch, h), this.db, {
  secrets,
  http: createSafeHttpClient(),
});
```

`register-agents-ipc.ts`：

```ts
const mcpStore = createMcpStore(db, deps.secrets);
register(IpcChannel.mcpList, () => mcpStore.list());
register(IpcChannel.mcpCreate, async (_e, input) => ({ ok: true, server: await mcpStore.create(input as McpServerInput) }));
register(IpcChannel.mcpDelete, async (_e, id) => { await mcpStore.remove(id as string); return { ok: true }; });
register(IpcChannel.mcpTest, (_e, args) => testMcpServer((args as { id: string }).id, mcpStore, {
  createClient: createMcpClient, transportDeps: { http: deps.http },
}));
```

- [ ] **Step 5: 完成 MCP transport 表单**

`McpSettingsPage.tsx` 新增 transport select、URL、逐行 `Header-Name: value` 输入；stdio 显示 command/args，sse/http 显示 URL/headers。保存 payload：

```tsx
const parseHeaders = (text: string) => Object.fromEntries(
  text.split('\n').filter(Boolean).map(line => {
    const colon = line.indexOf(':');
    if (colon < 1) throw new Error(t('settings.mcp.invalidHeader'));
    return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
  }),
);
const input = transport === 'stdio'
  ? { name, transport, command, args: args.split(/\s+/).filter(Boolean), agentIds }
  : { name, transport, url, headers: parseHeaders(headers), agentIds };
const result = await window.jarvis.invoke(IpcChannel.mcpCreate, input) as { ok: boolean; error?: string };
if (!result.ok) setFormError(result.error ?? t('settings.mcp.createFail'));
```

列表测试按钮必须调用：

```ts
window.jarvis.invoke(IpcChannel.mcpTest, { id: server.id });
```

测试断言选择 SSE 只提交 `url/headers`，选择 HTTP 提交 `transport:'http'`，测试按钮不再把 command、URL 或 headers 回传。

i18n 对称增加：`transport`、`transportStdio`、`transportSse`、`transportHttp`、`url`、`headers`、`headersHint`、`invalidHeader`、`createFail`。

- [ ] **Step 6: 验证 main、UI、i18n**

Run: `cd apps/desktop && pnpm vitest run src/main/ipc/mcp.spec.ts src/renderer/src/pages/settings/McpSettingsPage.spec.tsx && cd ../.. && pnpm i18n:check && pnpm typecheck`

Expected: MCP main/UI specs PASS，i18n 对称，workspace typecheck PASS。

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/ipc/mcp.ts apps/desktop/src/main/ipc/mcp.spec.ts apps/desktop/src/main/ipc/register-agents-ipc.ts apps/desktop/src/main/ipc/IpcRouter.ts apps/desktop/src/renderer/src/pages/settings/McpSettingsPage.tsx apps/desktop/src/renderer/src/pages/settings/McpSettingsPage.spec.tsx packages/protocol/src/ipc-channels.ts packages/protocol/src/ipc-allowlist.ts packages/i18n/locales/zh-CN/common.json packages/i18n/locales/en/common.json
git diff --cached --check
git commit -m "feat: complete remote MCP configuration flow"
```

---

### Task 3: URL Skill 安全导入 IPC/UI 与冲突策略

**Files:**
- Modify: `packages/core/src/skills/SkillsLoader.ts`
- Modify: `packages/core/src/skills/SkillsLoader.spec.ts`
- Modify: `apps/desktop/src/main/ipc/skills.ts`
- Create: `apps/desktop/src/main/ipc/skills.spec.ts`
- Modify: `apps/desktop/src/main/ipc/register-agents-ipc.ts`
- Modify: `apps/desktop/src/renderer/src/pages/settings/SkillsSettingsPage.tsx`
- Create: `apps/desktop/src/renderer/src/pages/settings/SkillsSettingsPage.spec.tsx`
- Modify: `packages/protocol/src/ipc-channels.ts`
- Modify: `packages/protocol/src/ipc-allowlist.ts`
- Modify: `packages/i18n/locales/zh-CN/common.json`
- Modify: `packages/i18n/locales/en/common.json`

**Interfaces:**
- Consumes: 与 Task 1 相同的 `SafeHttpClient`。
- Produces:
  - `assertSkillName(name): string`
  - `downloadSkill(url, http, signal?): Promise<{ meta: SkillMeta; text: string }>`
  - `SkillConflictStrategy = 'skip'|'overwrite'|'rename'`
  - IPC `skills.importUrl` payload `{ url; strategy }`。

- [ ] **Step 1: 写安全名称、下载限制和冲突失败测试**

`SkillsLoader.spec.ts` 增加：

```ts
it.each(['../escape', '..', '/absolute', 'a/b', 'a\\b', '技能'])('rejects unsafe skill name %s', name => {
  expect(() => assertSkillName(name)).toThrow('SKILL_NAME_INVALID');
});
it('downloads markdown through SafeHttpClient with fixed limits', async () => {
  const request = vi.fn(async () => new Response(
    '---\nname: web-import\ndescription: imported\ntriggers: []\n---\nbody',
    { headers: { 'content-type': 'text/markdown' } },
  ));
  const result = await downloadSkill('https://skills.example/SKILL.md', { request } as never);
  expect(result.meta.name).toBe('web-import');
  expect(request).toHaveBeenCalledWith(expect.any(String), expect.any(Object), {
    signal: undefined, timeoutMs: 15_000, maxRedirects: 3, maxResponseBytes: 262_144,
  });
});
```

`apps/desktop/src/main/ipc/skills.spec.ts`：

```ts
it('renames a conflicting URL skill and writes only under the skill root', async () => {
  const store = createSkillsStore(db, agents, { skillRoot, download: async () => ({
    meta: { name: 'review', description: 'new', triggers: [], path: '' },
    text: '---\nname: review\ndescription: new\ntriggers: []\n---\nbody',
  }) });
  await store.importFromUrl('https://skills.example/review.md', 'overwrite');
  const renamed = await store.importFromUrl('https://skills.example/review.md', 'rename');
  expect(renamed.skill.name).toBe('review-2');
  expect(readFileSync(join(skillRoot, 'review-2', 'SKILL.md'), 'utf8')).toContain('name: review-2');
});
it('skip leaves the existing file and row unchanged', async () => {
  const first = await store.importFromUrl(url, 'overwrite');
  const second = await store.importFromUrl(url, 'skip');
  expect(second).toEqual({ ok: true, skipped: true, skill: first.skill });
  expect(db.prepare('SELECT COUNT(*) AS n FROM skills').get()).toEqual({ n: 1 });
});
```

- [ ] **Step 2: 运行失败测试**

Run: `cd packages/core && pnpm vitest run src/skills/SkillsLoader.spec.ts && cd ../../apps/desktop && pnpm vitest run src/main/ipc/skills.spec.ts`

Expected: FAIL，安全下载和 URL store 尚不存在。

- [ ] **Step 3: 实现 core 安全解析**

`SkillsLoader.ts`：

```ts
import type { SafeHttpClient } from '../network/SafeHttpClient';

export function assertSkillName(name: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name) || name.includes('..')) {
    throw new Error('SKILL_NAME_INVALID');
  }
  return name;
}

export async function downloadSkill(
  url: string, http: SafeHttpClient, signal?: AbortSignal,
): Promise<{ meta: SkillMeta; text: string }> {
  const response = await http.request(url, { method: 'GET', signal, headers: { Accept: 'text/markdown, text/plain' } }, {
    signal, timeoutMs: 15_000, maxRedirects: 3, maxResponseBytes: 262_144,
  });
  if (!response.ok) throw new Error(`SKILL_HTTP_${response.status}`);
  const type = response.headers.get('content-type')?.split(';')[0] ?? '';
  if (!['text/markdown', 'text/plain', 'application/octet-stream'].includes(type)) throw new Error('SKILL_CONTENT_TYPE_INVALID');
  const text = await response.text();
  const meta = parseSkillFrontmatter(text);
  assertSkillName(meta.name);
  return { meta, text };
}
```

删除旧 `importSkillFromUrl` 的直接 fetch/写盘实现；网络策略和写盘分别由 `downloadSkill` 与 main store 拥有。

- [ ] **Step 4: 实现 main 冲突事务**

`skills.ts` 中增加：

```ts
export type SkillConflictStrategy = 'skip' | 'overwrite' | 'rename';
const withName = (text: string, name: string) => text.replace(/^name:\s*.*$/m, `name: ${name}`);

async importFromUrl(url: string, strategy: SkillConflictStrategy) {
  const downloaded = await deps.download(url);
  let name = assertSkillName(downloaded.meta.name);
  const existing = () => db.prepare('SELECT id, name, path, description FROM skills WHERE name = ?').get(name) as SkillRow | undefined;
  if (existing() && strategy === 'skip') return { ok: true as const, skipped: true, skill: existing()! };
  if (existing() && strategy === 'rename') {
    const base = name;
    for (let suffix = 2; existing(); suffix++) name = `${base}-${suffix}`;
  }
  const text = withName(downloaded.text, name);
  const targetDir = join(deps.skillRoot, name);
  mkdirSync(targetDir, { recursive: true });
  const canonicalRoot = realpathSync(deps.skillRoot);
  const canonicalDir = realpathSync(targetDir);
  const rel = relative(canonicalRoot, canonicalDir);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('SKILL_DEST_OUTSIDE_ROOT');
  const target = join(canonicalDir, 'SKILL.md');
  const temp = join(canonicalDir, `.SKILL.${randomUUID()}.tmp`);
  writeFileSync(temp, text, { encoding: 'utf8', flag: 'wx' });
  if (strategy !== 'overwrite' && existsSync(target)) {
    unlinkSync(temp);
    throw new Error('SKILL_CONFLICT');
  }
  renameSync(temp, target);
  const id = existing()?.id ?? randomUUID();
  db.transaction(() => {
    db.prepare(`INSERT INTO skills (id,name,path,description,created_at) VALUES (?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,path=excluded.path,description=excluded.description`)
      .run(id, name, target, downloaded.meta.description, new Date().toISOString());
  })();
  const skill = { id, name, path: target, description: downloaded.meta.description };
  this.copyToBoundWorkspaces({ ...downloaded.meta, name, path: target });
  return { ok: true as const, skipped: false, skill };
}
```

实现时先 `mkdirSync(deps.skillRoot, { recursive:true })` 并取得 canonical root；对新子目录，canonical 校验目标父级前先创建父级，再 `realpathSync`。写入必须使用同目录临时文件 + 原子 rename，不能直接覆盖可能指向根外的 `SKILL.md` symlink；异常时清理 temp。增加目标目录 symlink、目标文件 symlink、写入后 DB 失败的测试，DB 失败时恢复原文件或删除新文件。`overwrite` 复用原 row ID；`rename` 产生新 row，并在追加 suffix 前截断 base 以继续满足 64 字符名称上限。

注册：

```ts
register(IpcChannel.skillsImportUrl, async (_e, args) => {
  try {
    const { url, strategy } = args as { url: string; strategy: SkillConflictStrategy };
    return await skillsStore.importFromUrl(url, strategy);
  } catch (e) {
    return { ok: false as const, code: e instanceof Error ? e.message : 'SKILL_IMPORT_FAILED', error: String(e) };
  }
});
```

- [ ] **Step 5: 实现 URL 导入 UI**

`SkillsSettingsPage.tsx` 在本地导入旁增加 URL、冲突策略和结果：

```tsx
const [url, setUrl] = useState('');
const [strategy, setStrategy] = useState<SkillConflictStrategy>('skip');
const [error, setError] = useState('');
const importUrl = async () => {
  const result = await window.jarvis.invoke(IpcChannel.skillsImportUrl, { url, strategy }) as {
    ok: boolean; skipped?: boolean; error?: string;
  };
  if (!result.ok) { setError(result.error ?? t('settings.skills.importFailed')); return; }
  setError(''); setUrl(''); await refresh();
};
```

RTL 测试输入 HTTPS URL、选择 overwrite、点击导入，断言：

```ts
expect(invoke).toHaveBeenCalledWith(IpcChannel.skillsImportUrl, {
  url: 'https://skills.example/review.md', strategy: 'overwrite',
});
```

i18n 对称增加 `importLocal`、`importUrl`、`urlPlaceholder`、`conflictStrategy`、`skip`、`overwrite`、`rename`、`importFailed`。

- [ ] **Step 6: 验证 core、main、UI、i18n**

Run: `cd packages/core && pnpm vitest run src/skills/SkillsLoader.spec.ts && cd ../../apps/desktop && pnpm vitest run src/main/ipc/skills.spec.ts src/renderer/src/pages/settings/SkillsSettingsPage.spec.tsx && cd ../.. && pnpm i18n:check && pnpm typecheck`

Expected: 全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/skills/SkillsLoader.ts packages/core/src/skills/SkillsLoader.spec.ts apps/desktop/src/main/ipc/skills.ts apps/desktop/src/main/ipc/skills.spec.ts apps/desktop/src/main/ipc/register-agents-ipc.ts apps/desktop/src/renderer/src/pages/settings/SkillsSettingsPage.tsx apps/desktop/src/renderer/src/pages/settings/SkillsSettingsPage.spec.tsx packages/protocol/src/ipc-channels.ts packages/protocol/src/ipc-allowlist.ts packages/i18n/locales/zh-CN/common.json packages/i18n/locales/en/common.json
git diff --cached --check
git commit -m "feat: complete secure URL skill import"
```

---

### Task 4: 恢复 Provider Guide 并建立链接检查

**Files:**
- Create: `docs/provider-guide.md`（恢复被删除文件并更新）
- Create: `scripts/docs-links.mjs`
- Create: `scripts/docs-links.spec.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `extractMarkdownLinks(markdown): string[]`、`checkLocalLinks(markdownFile, links): string[]`、root script `docs:links`。

- [ ] **Step 1: 写链接检查失败测试**

`scripts/docs-links.spec.mjs`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractMarkdownLinks, checkLocalLinks } from './docs-links.mjs';

test('extracts markdown links and reports missing local targets', () => {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-doc-links-'));
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'present.json'), '{}');
  const file = join(root, 'docs', 'guide.md');
  const links = extractMarkdownLinks('[ok](../present.json) [missing](../missing.json) [section](#part)');
  assert.deepEqual(links, ['../present.json', '../missing.json', '#part']);
  assert.deepEqual(checkLocalLinks(file, links), [`${file}: ../missing.json`]);
});
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test scripts/docs-links.spec.mjs`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现无依赖链接检查器**

`scripts/docs-links.mjs`：

```js
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const extractMarkdownLinks = markdown =>
  [...markdown.matchAll(/!?\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map(match => match[1]);

export function checkLocalLinks(markdownFile, links) {
  return links
    .filter(link => !link.startsWith('#') && !/^(https?:|mailto:)/.test(link))
    .filter(link => !existsSync(resolve(dirname(markdownFile), decodeURIComponent(link.split('#')[0]))))
    .map(link => `${markdownFile}: ${link}`);
}

export function main(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const guide = resolve(root, 'docs/provider-guide.md');
  const failures = checkLocalLinks(guide, extractMarkdownLinks(readFileSync(guide, 'utf8')));
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
```

`package.json` 增加：

```json
"docs:links": "node scripts/docs-links.mjs"
```

- [ ] **Step 4: 恢复并更新 Provider Guide**

`docs/provider-guide.md` 必须包含这些具体章节：

```md
# 第三方自定义 Provider 接入

JARVIS 不预设模型 ID。先复制并编辑
[`resources/provider-templates/openai-compatible.json`](../resources/provider-templates/openai-compatible.json)，
再从“设置 → 配置导入导出”导入，最后在 Provider 页面填写密钥并添加服务实际支持的模型 ID。

## 安全边界

- API Key 由 Provider 页面写入系统 SecureStorage；JSON、SQLite、WAL、备份和导出只保存 `apiKeyRef`。
- Base URL 必须使用 HTTPS，不能包含 `user:password@host`；DNS 解析、重定向和私网地址由统一 URL 安全策略校验。
- 模板中的 `models` 必须保持空数组；模型 ID 完全由用户配置。

## 兼容模式

- `openai-compatible` 要求兼容聊天流、structured tool call 和 tool result 的 OpenAI 请求/响应形状。
- `anthropic-compatible` 要求兼容 Messages 流、`tool_use`、`input_json_delta` 和 `tool_result`。
- 服务只实现协议子集时，连接测试通过不代表工具调用可用；应运行一个真实工具任务验证两轮调用。

## 导入步骤

1. 复制模板，修改 Provider `id`、`name` 和 `baseUrl`。
2. 保持 `apiKeyRef` 为空、`models` 为空。
3. 在“设置 → 配置导入导出”选择 skip、overwrite 或 merge 后导入。
4. 在 Provider 页面填写 API Key；JARVIS 只把 Key 写入 SecureStorage。
5. 添加服务文档声明支持的模型 ID并执行连接测试。

## 故障排查

- `schemaVersion` 高于当前版本：升级 JARVIS 后重新导入。
- URL 被拒绝：确认 HTTPS、无 URL credentials、目标不是本机或私网地址。
- 401/403：重新保存 API Key，不要把密钥写入模板。
- 工具第二轮失败：核对所选兼容模式是否完整实现 tool call/result。
```

- [ ] **Step 5: 验证文档**

Run: `node --test scripts/docs-links.spec.mjs && pnpm docs:links`

Expected: 两条命令 PASS，guide 中模板链接存在。

- [ ] **Step 6: Commit**

```bash
git add docs/provider-guide.md scripts/docs-links.mjs scripts/docs-links.spec.mjs package.json
git diff --cached --check
git commit -m "docs: restore provider onboarding guide"
```

---

### Task 5: Canvas taskId 路由与 Task 入口

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/App.spec.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/CanvasPage.tsx`
- Create: `apps/desktop/src/renderer/src/pages/CanvasPage.spec.tsx`
- Modify: `apps/desktop/src/renderer/src/components/tasks/TaskBoard.tsx`
- Modify: `apps/desktop/src/renderer/src/components/tasks/TaskBoard.spec.tsx`
- Modify: `packages/i18n/locales/zh-CN/common.json`
- Modify: `packages/i18n/locales/en/common.json`

**Interfaces:**
- Consumes: `useTaskStore.activeTaskId`、已有 `CanvasView({ taskId })`、`artifacts.list`。
- Produces: `/canvas/:taskId` 主路由、`/canvas` 使用 active task 回退、Task 卡片“打开 Canvas”入口。

- [ ] **Step 1: 写页面路由和任务入口失败测试**

`CanvasPage.spec.tsx`：

```tsx
it('loads route taskId instead of active task', async () => {
  useTaskStore.setState({ activeTaskId: 'active-1' });
  render(<MemoryRouter initialEntries={['/canvas/route-2']}><Routes>
    <Route path="/canvas/:taskId" element={<CanvasPage />} />
  </Routes></MemoryRouter>);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('artifacts.list', 'route-2'));
});

it('falls back to active task on /canvas', async () => {
  useTaskStore.setState({ activeTaskId: 'active-1' });
  render(<MemoryRouter initialEntries={['/canvas']}><Routes>
    <Route path="/canvas" element={<CanvasPage />} />
  </Routes></MemoryRouter>);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('artifacts.list', 'active-1'));
});
```

`TaskBoard.spec.tsx` 用 `MemoryRouter` 包装后断言：

```ts
expect(screen.getByTestId('task-canvas-t2').getAttribute('href')).toBe('/canvas/t2');
```

- [ ] **Step 2: 运行失败测试**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/pages/CanvasPage.spec.tsx src/renderer/src/components/tasks/TaskBoard.spec.tsx src/renderer/src/App.spec.tsx`

Expected: FAIL，页面未读取参数，Task 卡没有 Canvas link。

- [ ] **Step 3: 实现路由解析**

`CanvasPage.tsx`：

```tsx
import { useParams } from 'react-router-dom';
import { useTaskStore } from '../stores/task-store';

export function CanvasPage() {
  const { taskId: routeTaskId } = useParams<{ taskId: string }>();
  const activeTaskId = useTaskStore(s => s.activeTaskId);
  const taskId = routeTaskId ?? activeTaskId ?? undefined;
  const { t } = useTranslation('common');
  return (
    <div data-testid="canvas-page">
      <h1>{t('canvas.title')}</h1>
      <CanvasView taskId={taskId} />
    </div>
  );
}
```

`App.tsx`：

```tsx
<Route path="/canvas/:taskId" element={<CanvasPage />} />
<Route path="/canvas" element={<CanvasPage />} />
```

App test 将旧“无 taskId 永远空态”断言改为：

```ts
useTaskStore.setState({ activeTaskId: 't-active' });
window.history.replaceState({}, '', '/canvas/t-route');
render(<App />);
await waitFor(() => expect(invoke).toHaveBeenCalledWith('artifacts.list', 't-route'));
```

- [ ] **Step 4: 从 TaskBoard 打开产物**

`TaskBoard.tsx`：

```tsx
import { Link } from 'react-router-dom';
// 每张 task card 内：
<Link data-testid={`task-canvas-${task.id}`} to={`/canvas/${encodeURIComponent(task.id)}`}>
  {t('board.openCanvas')}
</Link>
```

组件补 `useTranslation('common')`。zh-CN/en 增加 `board.openCanvas`：`打开 Canvas` / `Open Canvas`。

- [ ] **Step 5: 验证 Canvas 主路径**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/pages/CanvasPage.spec.tsx src/renderer/src/components/canvas/CanvasView.spec.tsx src/renderer/src/components/tasks/TaskBoard.spec.tsx src/renderer/src/App.spec.tsx && cd ../.. && pnpm i18n:check`

Expected: route taskId、active task fallback、TaskBoard link 和 artifact 渲染全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/App.spec.tsx apps/desktop/src/renderer/src/pages/CanvasPage.tsx apps/desktop/src/renderer/src/pages/CanvasPage.spec.tsx apps/desktop/src/renderer/src/components/tasks/TaskBoard.tsx apps/desktop/src/renderer/src/components/tasks/TaskBoard.spec.tsx packages/i18n/locales/zh-CN/common.json packages/i18n/locales/en/common.json
git diff --cached --check
git commit -m "feat: route task artifacts into Canvas"
```

---

### Task 6: VersionHistory 挂入 Agent Detail 并刷新回滚配置

**Files:**
- Modify: `apps/desktop/src/main/ipc/register-agents-ipc.ts`
- Modify: `apps/desktop/src/main/ipc/agents-versions.spec.ts`
- Modify: `apps/desktop/src/renderer/src/components/squad/VersionHistoryPage.tsx`
- Modify: `apps/desktop/src/renderer/src/components/squad/VersionHistoryPage.spec.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/AgentDetailPage.tsx`
- Create: `apps/desktop/src/renderer/src/pages/AgentDetailPage.spec.tsx`

**Interfaces:**
- Consumes: `agents.versions`、`agents.rollback`、`useAgentStore.refresh`。
- Produces:
  - rollback 成功响应 `{ ok:true; agent: AgentConfig }`
  - `VersionHistoryPage({ agentId, onRolledBack? })`
  - Agent 详情在 rollback 后同步 name/systemPrompt/modelId/workspaceId。

- [ ] **Step 1: 写 rollback 返回当前配置的 main 失败测试**

在 `agents-versions.spec.ts` 增加 register 层测试，捕获 handler 后：

```ts
const result = rollbackHandler(event, { id: agent.id, versionId }) as {
  ok: boolean; agent?: AgentConfig;
};
expect(result.ok).toBe(true);
expect(result.agent).toMatchObject({ id: agent.id, name: 'before-update' });
```

- [ ] **Step 2: 写 Agent Detail 集成失败测试**

`AgentDetailPage.spec.tsx`：

```tsx
it('renders history for existing agent and replaces form values after rollback', async () => {
  useAgentStore.setState({ agents: [{
    id: 'a1', name: 'current', slug: 'current', systemPrompt: 'current prompt',
    modelId: 'm2', workspaceId: '/new', createdAt: '', updatedAt: '',
  }], current: null });
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'agents.versions') return {
      ok: true, versions: [{ id: 'v1', createdAt: '2026-08-06T00:00:00Z', fields: ['name'] }],
    };
    if (channel === 'agents.rollback') return {
      ok: true, agent: {
        id: 'a1', name: 'restored', slug: 'restored', systemPrompt: 'old prompt',
        modelId: 'm1', workspaceId: '/old', createdAt: '', updatedAt: '',
      },
    };
    if (channel === IpcChannel.agentList) return [];
  });
  window.jarvis = { invoke, onDidReceive: () => () => {} } as never;
  render(<AgentDetailPage agentId="a1" onClose={() => {}} />);
  fireEvent.click(await screen.findByTestId('rollback-v1'));
  await waitFor(() => expect((screen.getByTestId('agent-name') as HTMLInputElement).value).toBe('restored'));
  expect((screen.getByTestId('agent-prompt') as HTMLTextAreaElement).value).toBe('old prompt');
  expect((screen.getByTestId('agent-model') as HTMLInputElement).value).toBe('m1');
});
```

- [ ] **Step 3: 运行失败测试**

Run: `cd apps/desktop && pnpm vitest run src/main/ipc/agents-versions.spec.ts src/renderer/src/pages/AgentDetailPage.spec.tsx src/renderer/src/components/squad/VersionHistoryPage.spec.tsx`

Expected: FAIL，rollback 没有返回 agent，AgentDetail 没有 history。

- [ ] **Step 4: 让 rollback 返回持久化后的 AgentConfig**

`register-agents-ipc.ts` 成功分支：

```ts
agents.versions.rollback(versionId, id);
return { ok: true as const, agent: agents.get(id) };
```

该返回值必须来自 rollback 写入后的 `agents.get(id)`，不得回传 snapshot JSON，确保 `slug/updatedAt` 等持久化派生字段与当前数据库一致。

- [ ] **Step 5: 增加 VersionHistory 回调并挂入详情**

`VersionHistoryPage.tsx`：

```tsx
export function VersionHistoryPage({
  agentId, onRolledBack,
}: {
  agentId: string;
  onRolledBack?: (agent: AgentConfig) => void | Promise<void>;
}) {
  // ...
  const res = await window.jarvis.invoke(IpcChannel.agentRollback, { id: agentId, versionId }) as
    { ok: true; agent: AgentConfig } | { ok: false; error?: string };
  if (!res.ok) { setError(res.error ?? 'rollback failed'); return; }
  await onRolledBack?.(res.agent);
  setDiff(t('versionHistory.rolledBack'));
  setError(null);
  await refresh();
}
```

`AgentDetailPage.tsx`：

```tsx
import type { AgentConfig } from '@jarvis/protocol';
import { VersionHistoryPage } from '../components/squad/VersionHistoryPage';

const applyRolledBack = async (agent: AgentConfig) => {
  setName(agent.name);
  setSystemPrompt(agent.systemPrompt);
  setModelId(agent.modelId);
  setWorkspaceId(agent.workspaceId);
  await refresh();
};

// agentId 非空时，放在保存按钮之后：
{agentId ? <VersionHistoryPage agentId={agentId} onRolledBack={applyRolledBack} /> : null}
```

`VersionHistoryPage.spec.tsx` 更新成功 mock，返回完整 `agent`，并断言 `onRolledBack` 收到该对象；失败时 callback 不调用。

- [ ] **Step 6: 验证 Agent 版本主路径**

Run: `cd apps/desktop && pnpm vitest run src/main/ipc/agents-versions.spec.ts src/renderer/src/pages/AgentDetailPage.spec.tsx src/renderer/src/components/squad/VersionHistoryPage.spec.tsx src/renderer/src/stores/agent-store.spec.ts`

Expected: history 可见，成功 rollback 刷新表单/store，失败保留原表单，全部 PASS。

- [ ] **Step 7: 全 plan 验证**

Run: `pnpm typecheck && pnpm test && pnpm i18n:check && pnpm docs:links`

Expected: 全部 PASS；若 Desktop Vitest 因本机 `better-sqlite3` ABI 不匹配，先执行 `cd apps/desktop && pnpm rebuild:node`，再原样重跑上述命令。

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/main/ipc/register-agents-ipc.ts apps/desktop/src/main/ipc/agents-versions.spec.ts apps/desktop/src/renderer/src/components/squad/VersionHistoryPage.tsx apps/desktop/src/renderer/src/components/squad/VersionHistoryPage.spec.tsx apps/desktop/src/renderer/src/pages/AgentDetailPage.tsx apps/desktop/src/renderer/src/pages/AgentDetailPage.spec.tsx
git diff --cached --check
git commit -m "feat: expose agent version history in detail"
```

---

## Requirement Traceability

- REQ-02：Task 1 统一 transport；Task 2 让三种 transport 真实持久化、测试、绑定和调用，敏感 header 只进 SecureStorage。
- REQ-03：Task 3 复用统一 URL 安全策略，补 URL IPC/UI、下载限制、安全名称和 skip/overwrite/rename。
- REQ-04：Task 4 恢复 Provider 指南，记录 SecureStorage、无硬编码模型和协议差异，并用可执行脚本检查链接。
- REQ-07：Task 5 通过 `/canvas/:taskId`、active task fallback 和 TaskBoard link 让 artifact 可达。
- REQ-08：Task 6 把 VersionHistory 嵌入 Agent Detail，并用 rollback 返回的持久化 AgentConfig 刷新表单和 store。

## Self-Review Results

- Spec coverage：五个 REQ 均有唯一 Task 归属、失败测试、实现、验证和独立提交。
- Security coverage：MCP secret headers 不进入 SQLite；MCP test 不接收可执行配置；MCP remote 与 URL Skill 都只消费同一 `SafeHttpClient`。
- Type consistency：数据库 transport `'http'` 只在 core 映射为 `'streamable-http'`；`agents.rollback` 成功响应统一携带 `AgentConfig`；Canvas 的 taskId 始终为字符串或 undefined。
- Renderer boundary：Canvas/TaskBoard 只使用 `@jarvis/core/renderer`；MCP、SafeHttpClient、SkillsLoader 保持 Node/main-only。
- Placeholder scan：所有步骤均给出确定文件、接口、测试、实现、命令和提交范围。
