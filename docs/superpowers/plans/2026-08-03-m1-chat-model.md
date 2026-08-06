# M1 对话+模型 (Chat & Model) 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本计划依赖 M0 已建成的 Monorepo(`packages/protocol`、`packages/i18n`、`apps/desktop` 壳、SQLite schema v1、IPC 框架、settings/theme/i18n)。

**Goal:** 实现全自定义 Provider/模型管理(OpenAI+Anthropic 双协议)、Keychain 密钥加密、ModelRouter 流式对话、会话持久化、Markdown 渲染、联网搜索、对话导出、连通诊断与网络重试/熔断。

**Architecture:** 引擎归属决策一 A——ModelRouter/ProviderAdapter 唯一实现在 `packages/core`(TS)。`apps/desktop` main 进程仅做 IPC 中转与 Keychain 代理;renderer 调用 core 经 IPC。OpenAI/Anthropic 适配器统一产出 `ChatChunk` 流;网络层注入 `fetchImpl` 以便单测。Provider 数据存 SQLite(`providers`/`models` 表,main 属主),API Key 只存 Keychain(`api_key_ref` 引用)。

**Tech Stack:** 在 M0 基础上新增:Node 内置 `fetch`(Node 20)、SSE 流解析、react-markdown + shiki、TikToken(可选用量预估)、`opossum`(熔断)、`ProxyAgent` 选配。沿用 vitest 单测 + Playwright E2E。

## Global Constraints

(全部继承 M0 计划的 Global Constraints,重点复述与 M1 直接相关者)

- **Q4 全自定义模型:** Provider 抽象兼容 OpenAI(/v1/chat/completions)与 Anthropic(/v1/messages)双协议;禁止硬编码任何 model id(如 gpt-4、claude-3);Provider 页只允许用户填写 model id。
- **B7 密钥加密:** API Key 仅存 Keychain/DPAPI;DB 存 `api_key_ref` 引用;日志脱敏过滤 `sk-`/`Bearer` 模式。
- **B8 连通测试:** 对用户填写的 model id 发真实最小 completion 请求 + 延迟测量。
- **B10 Fallback:** 主模型 HTTP 429/5xx 失败 → 按 agent fallback 链自动切换。
- **L34 重试/熔断:** ProviderPolicy `{ timeoutMs, maxRetries, circuitBreaker }`;断连重试失败返回明确错误(无离线缓冲)。
- **L33 代理:** 全局 HTTP/SOCKS 代理配置,ModelRouter 与 MCP HTTP 客户端共用。
- **每表单写者(§13.3):** providers/models/chat_sessions/chat_messages 由 Electron main 写入;core 经 IPC 委托。
- **性能:** 流式首 token < 2s(依赖 Provider);10 万 message 查询 < 100ms。
- **i18n:** 本里程碑新增 UI 文案须同时提供 zh-CN/en。

## 文件结构总览(本里程碑新增)

```
packages/core/src/
├── model/
│   ├── types.ts                 # ChatRequest/ChatChunk/Usage/ProviderAdapter
│   ├── adapters/
│   │   ├── openai.ts
│   │   ├── anthropic.ts
│   │   └── index.ts             # createAdapter(type)
│   └── router.ts                # ModelRouter(含 L34 策略)
├── chat/
│   ├── ChatService.ts           # 会话 + 流式 + 摘要占位
│   └── search.ts                # D3 web_search(可配置搜索引擎 API)
├── util/
│   ├── sse.ts                   # SSE 解析器
│   └── token.ts                 # 用量预估占位
└── index.ts
apps/desktop/src/main/
├── secrets/SecureStorage.ts     # B7 Keychain(安全存储代理)
├── ipc/providers.ts             # provider CRUD + provider.test
├── ipc/chat.ts                  # chat.send/chat.listSessions/...
├── ipc/sessions.ts              # 会话列表
└── ipc/IpcRouter.ts             # 扩展注册
apps/desktop/src/renderer/src/
├── pages/ChatPage.tsx           # 真实多轮对话 UI(流式)
├── pages/settings/ProviderSettingsPage.tsx  # 真实 CRUD
├── components/chat/
│   ├── MessageBubble.tsx
│   ├── MarkdownView.tsx         # D13
│   └── ChatInput.tsx
├── stores/chat-store.ts         # 会话 + 消息 + 流式状态
└── stores/provider-store.ts     # TanStack Query 缓存
```

---

### Task 1: packages/core 模型类型与 ProviderAdapter 接口

**Files:**
- Create: `packages/core/src/model/types.ts`
- Create: `packages/core/src/model/types.spec.ts`
- Create: `packages/core/src/index.ts`(重导出)

**Interfaces:**
- Consumes: M0 Task 2 `ProviderType` 类型(`@jarvis/protocol`)。
- Produces:
  - `ModelRole = 'system' | 'user' | 'assistant' | 'tool'`
  - `ModelMessage { role, content, name? }`
  - `ChatRequest { provider: Provider; modelId: string; messages: ModelMessage[]; stream: boolean; maxTokens?: number; temperature?: number; reasoning?: 'low'|'medium'|'high' }`
  - `ToolCall { id; name; arguments: Record<string, unknown> }`
  - `Usage { promptTokens; completionTokens; totalTokens }`
  - `ChatChunk = { kind:'delta'; delta } | { kind:'tool_call'; toolCalls: ToolCall[] } | { kind:'usage'; usage: Usage } | { kind:'done' } | { kind:'error'; error }`
  - `ChatCallbacks { onChunk(chunk: ChatChunk): void; signal?: AbortSignal }`
  - `ProviderAdapter { type: ProviderType; chat(req, ctx: { apiKey: string } & ChatCallbacks): Promise<void> }`
  - `createAdapter(type: ProviderType, deps?: { fetchImpl? }): ProviderAdapter`

- [ ] **Step 1: 编写失败测试**

`packages/core/src/model/types.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isDoneChunk } from './types';

describe('model types', () => {
  it('recognizes done chunk', () => {
    expect(isDoneChunk({ kind: 'done' })).toBe(true);
    expect(isDoneChunk({ kind: 'delta', delta: 'x' })).toBe(false);
  });
  it('adapter factory returns adapter for both types', async () => {
    const { createAdapter } = await import('./adapters/index');
    expect(createAdapter('openai-compatible').type).toBe('openai-compatible');
    expect(createAdapter('anthropic-compatible').type).toBe('anthropic-compatible');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/core && pnpm vitest run src/model/types.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 编写实现**

`packages/core/src/model/types.ts`:
```ts
import type { Provider, ProviderType } from '@jarvis/protocol';

export type ModelRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ModelMessage {
  role: ModelRole;
  content: string;
  name?: string;
}

export interface ChatRequest {
  provider: Provider;
  modelId: string;
  messages: ModelMessage[];
  stream: boolean;
  maxTokens?: number;
  temperature?: number;
  reasoning?: 'low' | 'medium' | 'high';
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type ChatChunk =
  | { kind: 'delta'; delta: string }
  | { kind: 'tool_call'; toolCalls: ToolCall[] }
  | { kind: 'usage'; usage: Usage }
  | { kind: 'done' }
  | { kind: 'error'; error: string };

export function isDoneChunk(c: ChatChunk): boolean { return c.kind === 'done'; }

export interface ChatCallbacks {
  onChunk: (chunk: ChatChunk) => void;
  signal?: AbortSignal;
}

export interface ProviderAdapter {
  type: ProviderType;
  chat(req: ChatRequest, ctx: { apiKey: string } & ChatCallbacks): Promise<void>;
}
```

`packages/core/src/index.ts`:
```ts
export * from './model/types';
export * from './model/adapters/index';
export * from './model/router';
export * from './chat/ChatService';
export * from './chat/search';
```

- [ ] **Step 4: 运行测试确认失败(适配器工厂未实现)**

Run: `cd packages/core && pnpm vitest run src/model/types.spec.ts`
Expected: FAIL(`./adapters/index` 不存在)——先停在此,下一步实现工厂后再转绿。

- [ ] **Step 5: 提交占位(Task 2 一并提交)**

(与 Task 2 合并提交,见 Task 2 Step 5)

---

### Task 2: OpenAI / Anthropic 适配器(SSE 流式解析)

**Files:**
- Create: `packages/core/src/util/sse.ts`
- Create: `packages/core/src/model/adapters/openai.ts`
- Create: `packages/core/src/model/adapters/anthropic.ts`
- Create: `packages/core/src/model/adapters/index.ts`
- Create: `packages/core/src/model/adapters/adapters.spec.ts`

**Interfaces:**
- Consumes: Task 1 类型。
- Produces: `createAdapter(type, deps?: { fetchImpl? }): ProviderAdapter`。OpenAI:POST `${baseUrl}/v1/chat/completions`,SSE 行 `data: {"choices":[{"delta":{"content":...}}]}` → `delta` chunk;`data: [DONE]` → `done`。Anthropic:POST `${baseUrl}/v1/messages`,事件 `content_block_delta`(`delta.text`) → `delta`,`message_stop` → `done`。两者均提取 `usage` → `usage` chunk。`fetchImpl` 注入默认 `globalThis.fetch`。

- [ ] **Step 1: 编写失败测试**

`packages/core/src/model/adapters/adapters.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createAdapter } from './index';
import type { ChatRequest } from '../types';

function mockFetch(lines: string[]) {
  const body = lines.join('\n') + '\n';
  return async () => ({ ok: true, status: 200, body: new ReadableStream({
    start(c) {
      const enc = new TextEncoder();
      c.enqueue(enc.encode(body));
      c.close();
    }
  }) }) as unknown as Response;
}

describe('openai adapter', () => {
  it('streams deltas and done', async () => {
    const adapter = createAdapter('openai-compatible', { fetchImpl: mockFetch([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}',
      'data: {"choices":[{"delta":{"content":"lo"}}]}',
      'data: [DONE]'
    ]) });
    const chunks: string[] = [];
    const req: ChatRequest = {
      provider: { id: 'p1', name: 'p', type: 'openai-compatible', baseUrl: 'https://api.example.com', apiKeyRef: 'k', createdAt: '', updatedAt: '' },
      modelId: 'my-model', messages: [{ role: 'user', content: 'hi' }], stream: true
    };
    await adapter.chat(req, { apiKey: 'sk-test', onChunk: (c) => { if (c.kind === 'delta') chunks.push(c.delta); } });
    expect(chunks.join('')).toBe('Hello');
  });
});

describe('anthropic adapter', () => {
  it('streams text deltas', async () => {
    const adapter = createAdapter('anthropic-compatible', { fetchImpl: mockFetch([
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}'
    ]) });
    const chunks: string[] = [];
    const req: ChatRequest = {
      provider: { id: 'p1', name: 'p', type: 'anthropic-compatible', baseUrl: 'https://api.example.com', apiKeyRef: 'k', createdAt: '', updatedAt: '' },
      modelId: 'my-model', messages: [{ role: 'user', content: 'hi' }], stream: true
    };
    await adapter.chat(req, { apiKey: 'sk-ant-test', onChunk: (c) => { if (c.kind === 'delta') chunks.push(c.delta); } });
    expect(chunks.join('')).toBe('Hi');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/core && pnpm vitest run src/model/adapters/adapters.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 编写 SSE 解析器**

`packages/core/src/util/sse.ts`:
```ts
export async function* parseSSE(body: ReadableStream<Uint8Array> | null, onEvent?: (eventName: string, data: string) => void): AsyncGenerator<string> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) { eventName = line.slice(6).trim(); }
        else if (line.startsWith('data:')) {
          const data = line.slice(5).trim();
          onEvent?.(eventName, data);
          yield data;
          eventName = '';
        }
      }
    }
  }
}
```

- [ ] **Step 4: 编写 OpenAI 适配器**

`packages/core/src/model/adapters/openai.ts`:
```ts
import type { ChatRequest, ChatChunk, ProviderAdapter, Usage } from '../types';
import { parseSSE } from '../../util/sse';

export interface AdapterDeps { fetchImpl?: typeof fetch }

export class OpenAIAdapter implements ProviderAdapter {
  readonly type = 'openai-compatible' as const;
  constructor(private deps: AdapterDeps = {}) {}

  async chat(req: ChatRequest, ctx: { apiKey: string; onChunk: (c: ChatChunk) => void; signal?: AbortSignal }): Promise<void> {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const url = `${req.provider.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
    const body = {
      model: req.modelId,
      messages: req.messages,
      stream: true,
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {})
    };
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify(body),
      signal: ctx.signal
    });
    if (!res.ok) throw new Error(`openai http ${res.status}: ${await res.text()}`);
    for await (const data of parseSSE(res.body)) {
      if (data === '[DONE]') break;
      const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } };
      const delta = parsed.choices?.[0]?.delta;
      if (delta?.content) ctx.onChunk({ kind: 'delta', delta: delta.content });
      if (delta?.tool_calls?.length) {
        ctx.onChunk({ kind: 'tool_call', toolCalls: delta.tool_calls.map(tc => ({ id: tc.id, name: tc.function.name, arguments: safeParseJson(tc.function.arguments) })) });
      }
      if (parsed.usage) {
        ctx.onChunk({ kind: 'usage', usage: { promptTokens: parsed.usage.prompt_tokens, completionTokens: parsed.usage.completion_tokens, totalTokens: parsed.usage.total_tokens } });
      }
    }
    ctx.onChunk({ kind: 'done' });
  }
}

function safeParseJson(s: string): Record<string, unknown> {
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return {}; }
}
```

- [ ] **Step 5: 编写 Anthropic 适配器**

`packages/core/src/model/adapters/anthropic.ts`:
```ts
import type { ChatRequest, ChatChunk, ProviderAdapter } from '../types';
import { parseSSE } from '../../util/sse';

export class AnthropicAdapter implements ProviderAdapter {
  readonly type = 'anthropic-compatible' as const;
  constructor(private deps: { fetchImpl?: typeof fetch } = {}) {}

  async chat(req: ChatRequest, ctx: { apiKey: string; onChunk: (c: ChatChunk) => void; signal?: AbortSignal }): Promise<void> {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const url = `${req.provider.baseUrl.replace(/\/$/, '')}/v1/messages`;
    const system = req.messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
    const rest = req.messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }));
    const body = {
      model: req.modelId,
      max_tokens: req.maxTokens ?? 4096,
      system: system || undefined,
      messages: rest,
      stream: true
    };
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ctx.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: ctx.signal
    });
    if (!res.ok) throw new Error(`anthropic http ${res.status}: ${await res.text()}`);
    for await (const data of parseSSE(res.body)) {
      const parsed = JSON.parse(data) as { type?: string; delta?: { type?: string; text?: string; partial_json?: string }; index?: number; message?: { usage?: { input_tokens: number; output_tokens: number } } };
      if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta' && parsed.delta.text) {
        ctx.onChunk({ kind: 'delta', delta: parsed.delta.text });
      }
      if (parsed.type === 'message_stop') break;
      if (parsed.type === 'message_delta' && parsed.message?.usage) {
        const u = parsed.message.usage;
        ctx.onChunk({ kind: 'usage', usage: { promptTokens: u.input_tokens, completionTokens: u.output_tokens, totalTokens: u.input_tokens + u.output_tokens } });
      }
    }
    ctx.onChunk({ kind: 'done' });
  }
}
```

- [ ] **Step 6: 编写工厂与重导出**

`packages/core/src/model/adapters/index.ts`:
```ts
import type { ProviderType } from '@jarvis/protocol';
import type { ProviderAdapter } from '../types';
import { OpenAIAdapter } from './openai';
import { AnthropicAdapter } from './anthropic';

export function createAdapter(type: ProviderType, deps?: { fetchImpl?: typeof fetch }): ProviderAdapter {
  return type === 'anthropic-compatible' ? new AnthropicAdapter(deps) : new OpenAIAdapter(deps);
}
```

- [ ] **Step 7: 运行测试确认通过**

Run: `cd packages/core && pnpm vitest run src/model/adapters/adapters.spec.ts && pnpm vitest run src/model/types.spec.ts`
Expected: 全部 PASS。

- [ ] **Step 8: Commit(Task 1+2 一并)**

```bash
git add packages/core/src/model packages/core/src/util packages/core/src/index.ts
git commit -m "feat(core): model types + OpenAI/Anthropic streaming adapters"
```

---

### Task 3: Keychain SecureStorage(B7)与 secrets IPC

**Files:**
- Create: `apps/desktop/src/main/secrets/SecureStorage.ts`
- Create: `apps/desktop/src/main/secrets/SecureStorage.spec.ts`

**Interfaces:**
- Consumes: M0 IPC 框架。
- Produces: `SecureStorage` 类:`set(key, value)`、`get(key)`、`delete(key)`。macOS 用 `security` CLI 写 Keychain generic password(`security add-generic-password -U -a jarvis -s <key> -w <value>`),Windows 用 DPAPI(本里程碑 stub,`process.platform === 'win32'` 抛"待 M8"异常或使用 fallback 文件加密占位);日志脱敏函数 `redactSecrets(text)`(regex `sk-[A-Za-z0-9_-]+`、`Bearer\s+\S+`)。注入 `execImpl` 便于测试。

- [ ] **Step 1: 编写失败测试**

`apps/desktop/src/main/secrets/SecureStorage.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { SecureStorage, redactSecrets } from './SecureStorage';

describe('SecureStorage', () => {
  it('redacts sk- and Bearer tokens', () => {
    expect(redactSecrets('key sk-abc123XYZ and Bearer tok_99')).toBe('key [REDACTED] and [REDACTED]');
  });
  it('stores via keychain exec and retrieves', async () => {
    const calls: string[] = [];
    const store = new SecureStorage({
      platform: 'darwin' as NodeJS.Platform,
      execImpl: async (cmd, args) => {
        calls.push(cmd + ' ' + args.join(' '));
        const i = args.indexOf('-w');
        if (i >= 0) return { stdout: '', stderr: '' };
        return { stdout: 'sekret', stderr: '' };
      }
    });
    await store.set('provider.p1', 'sk-sekret');
    const got = await store.get('provider.p1');
    expect(got).toBe('sekret');
    expect(calls.some(c => c.includes('add-generic-password'))).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/desktop && pnpm vitest run src/main/secrets/SecureStorage.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 编写实现**

`apps/desktop/src/main/secrets/SecureStorage.ts`:
```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

export function redactSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, '[REDACTED]')
    .replace(/Bearer\s+\S+/g, 'Bearer [REDACTED]');
}

export interface SecureStorageDeps {
  platform?: NodeJS.Platform;
  execImpl?: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
}

const SERVICE = 'jarvis';

export class SecureStorage {
  private platform: NodeJS.Platform;
  private run: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

  constructor(deps: SecureStorageDeps = {}) {
    this.platform = deps.platform ?? process.platform;
    this.run = deps.execImpl ?? (async (cmd, args) => {
      try { return await exec(cmd, args); } catch (e) {
        const err = e as { stderr?: string; stdout?: string };
        return { stdout: err.stdout ?? '', stderr: err.stderr ?? String(e) };
      }
    });
  }

  async set(key: string, value: string): Promise<void> {
    if (this.platform === 'darwin') {
      await this.run('security', ['add-generic-password', '-U', '-a', SERVICE, '-s', key, '-w', value]);
      return;
    }
    throw new Error('secure storage for windows (DPAPI) lands in M8');
  }

  async get(key: string): Promise<string | null> {
    if (this.platform === 'darwin') {
      const r = await this.run('security', ['find-generic-password', '-a', SERVICE, '-s', key, '-w']);
      if (r.stderr && !r.stdout) return null;
      return r.stdout.trim() || null;
    }
    throw new Error('secure storage for windows (DPAPI) lands in M8');
  }

  async delete(key: string): Promise<void> {
    if (this.platform === 'darwin') {
      await this.run('security', ['delete-generic-password', '-a', SERVICE, '-s', key]);
    }
  }
}
```

- [ ] **Step 4: 注册 secrets IPC(修改 IpcRouter)**

```ts
const secrets = new SecureStorage();
this.register(IpcChannel.secretsSet, async (_e, key: string, value: string) => { await secrets.set(key, value); return { ok: true }; });
this.register(IpcChannel.secretsGet, async (_e, key: string) => secrets.get(key));
this.register(IpcChannel.secretsDelete, async (_e, key: string) => { await secrets.delete(key); return { ok: true }; });
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd apps/desktop && pnpm vitest run src/main/secrets/SecureStorage.spec.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/secrets apps/desktop/src/main/ipc/IpcRouter.ts
git commit -m "feat(secrets): keychain-backed secure storage with redaction (B7)"
```

---

### Task 4: Provider CRUD IPC 服务(B1–B4)

**Files:**
- Create: `apps/desktop/src/main/ipc/providers.ts`
- Create: `apps/desktop/src/main/ipc/providers.spec.ts`

**Interfaces:**
- Consumes: M0 schema v1(providers/models 表)、Task 3 SecureStorage。
- Produces:
  - `createProviderStore(db, secrets): ProviderStore` — 方法 `list(): Provider[]`、`create(input): Provider`、`update(id, patch): Provider`、`remove(id): void`、`listModels(providerId): Model[]`、`addModel(providerId, model): Model`。
  - 创建时生成 `api_key_ref`(格式 `provider:{id}:key`),key 明文只经 `secrets.set`,DB 存 ref。
  - IPC:provider.list / provider.create / provider.update / provider.delete。

- [ ] **Step 1: 编写失败测试**

`apps/desktop/src/main/ipc/providers.spec.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../db/migrations';
import { createProviderStore } from './providers';

describe('provider store', () => {
  let db: Database.Database;
  const secrets = { set: async () => {}, get: async () => null, delete: async () => {} };

  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  it('creates and lists provider with key ref', async () => {
    const store = createProviderStore(db, secrets);
    const p = await store.create({ name: 'My OpenAI', type: 'openai-compatible', baseUrl: 'https://api.openai.com', apiKey: 'sk-test' });
    expect(p.apiKeyRef).toBe(`provider:${p.id}:key`);
    expect(store.list().length).toBe(1);
  });

  it('adds model to provider', async () => {
    const store = createProviderStore(db, secrets);
    const p = await store.create({ name: 'P', type: 'openai-compatible', baseUrl: 'https://x.com', apiKey: 'sk-t' });
    const m = store.addModel(p.id, { modelId: 'custom-1', name: 'My custom model' });
    expect(m.providerId).toBe(p.id);
    expect(store.listModels(p.id).length).toBe(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/desktop && pnpm vitest run src/main/ipc/providers.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 编写实现**

`apps/desktop/src/main/ipc/providers.ts`:
```ts
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Provider, Model } from '@jarvis/protocol';
import type { SecureStorage } from '../secrets/SecureStorage';

export interface ProviderInput { name: string; type: 'openai-compatible' | 'anthropic-compatible'; baseUrl: string; apiKey: string }
export interface ModelInput { modelId: string; name: string }

export function createProviderStore(db: Database.Database, secrets: Pick<SecureStorage, 'set' | 'get' | 'delete'>) {
  const now = () => new Date().toISOString();
  const rowToProvider = (r: Record<string, unknown>): Provider => ({
    id: r.id as string, name: r.name as string, type: r.type as Provider['type'],
    baseUrl: r.base_url as string, apiKeyRef: r.api_key_ref as string,
    createdAt: r.created_at as string, updatedAt: r.updated_at as string
  });

  return {
    list(): Provider[] {
      return (db.prepare('SELECT * FROM providers ORDER BY created_at').all() as Record<string, unknown>[]).map(rowToProvider);
    },
    async create(input: ProviderInput): Promise<Provider> {
      const id = randomUUID();
      const ref = `provider:${id}:key`;
      db.prepare('INSERT INTO providers (id, name, type, base_url, api_key_ref, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
        .run(id, input.name, input.type, input.baseUrl, ref, now(), now());
      await secrets.set(ref, input.apiKey);
      return this.list().find(p => p.id === id)!;
    },
    async update(id: string, patch: Partial<ProviderInput>): Promise<Provider> {
      const cur = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      if (!cur) throw new Error(`provider not found: ${id}`);
      const name = patch.name ?? cur.name as string;
      const type = patch.type ?? cur.type as Provider['type'];
      const baseUrl = patch.baseUrl ?? cur.base_url as string;
      db.prepare('UPDATE providers SET name=?, type=?, base_url=?, updated_at=? WHERE id=?').run(name, type, baseUrl, now(), id);
      if (patch.apiKey !== undefined) await secrets.set(`provider:${id}:key`, patch.apiKey);
      return rowToProvider(db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as Record<string, unknown>);
    },
    async remove(id: string): Promise<void> {
      db.prepare('DELETE FROM providers WHERE id = ?').run(id);
      await secrets.delete(`provider:${id}:key`);
    },
    listModels(providerId: string): Model[] {
      return (db.prepare('SELECT * FROM models WHERE provider_id = ? ORDER BY created_at').all(providerId) as Record<string, unknown>[]).map(r => ({
        id: r.id as string, providerId: r.provider_id as string, modelId: r.model_id as string,
        name: r.name as string, createdAt: r.created_at as string
      }));
    },
    addModel(providerId: string, input: ModelInput): Model {
      const id = randomUUID();
      db.prepare('INSERT INTO models (id, provider_id, model_id, name, created_at) VALUES (?,?,?,?,?)').run(id, providerId, input.modelId, input.name, now());
      return this.listModels(providerId).find(m => m.id === id)!;
    }
  };
}
```

- [ ] **Step 4: 注册 IPC(修改 IpcRouter)**

```ts
const providers = createProviderStore(this.db, secrets);
this.register(IpcChannel.providerList, () => providers.list());
this.register(IpcChannel.providerCreate, (_e, input) => providers.create(input));
this.register(IpcChannel.providerUpdate, (_e, id, patch) => providers.update(id, patch));
this.register(IpcChannel.providerDelete, (_e, id) => providers.remove(id));
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd apps/desktop && pnpm vitest run src/main/ipc/providers.spec.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/ipc/providers.ts apps/desktop/src/main/ipc/providers.spec.ts apps/desktop/src/main/ipc/IpcRouter.ts
git commit -m "feat(providers): CRUD store with keychain refs (B1-B4)"
```

---

### Task 5: ProviderSettingsPage 真实 CRUD UI(C1 完成) + Provider 模板选择

**Files:**
- Create: `apps/desktop/src/renderer/src/stores/provider-store.ts`
- Modify: `apps/desktop/src/renderer/src/pages/settings/ProviderSettingsPage.tsx`
- Create: `apps/desktop/src/renderer/src/pages/settings/ProviderForm.tsx`
- Create: `apps/desktop/src/renderer/src/pages/settings/ProviderSettingsPage.spec.tsx`

**Interfaces:**
- Consumes: Task 4 IPC(`provider.list/create/update/delete`)、M0 `window.jarvis`。
- Produces: 页面支持类型下拉(openai-compatible/anthropic-compatible)、Base URL、Key、添加 model id 列表;TanStack Query 管理列表缓存与乐观更新;空态文案 i18n。

- [ ] **Step 1: 编写 provider store**

`apps/desktop/src/renderer/src/stores/provider-store.ts`:
```ts
import { create } from 'zustand';
import type { Provider } from '@jarvis/protocol';

interface ProviderState {
  providers: Provider[];
  loading: boolean;
  refresh: () => Promise<void>;
  create: (input: { name: string; type: 'openai-compatible' | 'anthropic-compatible'; baseUrl: string; apiKey: string }) => Promise<Provider>;
  remove: (id: string) => Promise<void>;
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  providers: [],
  loading: false,
  async refresh() {
    set({ loading: true });
    const providers = (await window.jarvis.invoke('provider.list')) as Provider[];
    set({ providers, loading: false });
  },
  async create(input) {
    const p = (await window.jarvis.invoke('provider.create', input)) as Provider;
    set({ providers: [...get().providers, p] });
    return p;
  },
  async remove(id) {
    await window.jarvis.invoke('provider.delete', id);
    set({ providers: get().providers.filter(p => p.id !== id) });
  }
}));
```

- [ ] **Step 2: 编写失败测试**

`apps/desktop/src/renderer/src/pages/settings/ProviderSettingsPage.spec.tsx`:
```tsx
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { ProviderSettingsPage } from './ProviderSettingsPage';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

describe('ProviderSettingsPage', () => {
  it('renders created provider after form submit', async () => {
    (window as unknown as { jarvis: unknown }).jarvis = {
      invoke: async (method: string) => {
        if (method === 'provider.list') return [];
        if (method === 'provider.create') return { id: 'p1', name: 'My Provider', type: 'openai-compatible', baseUrl: 'https://x.com', apiKeyRef: 'k', createdAt: '', updatedAt: '' };
        return [];
      }
    };
    render(<ProviderSettingsPage />);
    fireEvent.click(screen.getByTestId('provider-add-open'));
    fireEvent.change(screen.getByTestId('provider-name'), { target: { value: 'My Provider' } });
    fireEvent.change(screen.getByTestId('provider-baseurl'), { target: { value: 'https://x.com' } });
    fireEvent.change(screen.getByTestId('provider-apikey'), { target: { value: 'sk-x' } });
    fireEvent.click(screen.getByTestId('provider-save'));
    await waitFor(() => expect(screen.getByText('My Provider')).toBeTruthy());
  });
});
```

- [ ] **Step 3: 编写表单与页面**

`apps/desktop/src/renderer/src/pages/settings/ProviderForm.tsx`:
```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProviderStore } from '../../stores/provider-store';

export function ProviderForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation('common');
  const create = useProviderStore((s) => s.create);
  const [name, setName] = useState('');
  const [type, setType] = useState<'openai-compatible' | 'anthropic-compatible'>('openai-compatible');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');

  const submit = async () => {
    await create({ name, type, baseUrl, apiKey });
    onDone();
  };

  return (
    <form data-testid="provider-form">
      <input data-testid="provider-name" placeholder={t('settings.provider.name')} value={name} onChange={e => setName(e.target.value)} />
      <select data-testid="provider-type" value={type} onChange={e => setType(e.target.value as typeof type)}>
        <option value="openai-compatible">OpenAI Compatible</option>
        <option value="anthropic-compatible">Anthropic Compatible</option>
      </select>
      <input data-testid="provider-baseurl" placeholder={t('settings.provider.baseUrl')} value={baseUrl} onChange={e => setBaseUrl(e.target.value)} />
      <input data-testid="provider-apikey" type="password" placeholder={t('settings.provider.apiKey')} value={apiKey} onChange={e => setApiKey(e.target.value)} />
      <button type="button" data-testid="provider-save" onClick={() => void submit()}>{t('common.save')}</button>
    </form>
  );
}
```

`apps/desktop/src/renderer/src/pages/settings/ProviderSettingsPage.tsx`(重写):
```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProviderStore } from '../../stores/provider-store';
import { ProviderForm } from './ProviderForm';

export function ProviderSettingsPage() {
  const { t } = useTranslation('common');
  const { providers, refresh, remove } = useProviderStore();
  const [showForm, setShowForm] = useState(false);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div data-testid="provider-settings">
      <h2>{t('settings.provider.title')}</h2>
      <button data-testid="provider-add-open" onClick={() => setShowForm(true)}>{t('settings.provider.add')}</button>
      {showForm && <ProviderForm onDone={() => setShowForm(false)} />}
      {providers.length === 0 && !showForm && <p data-testid="provider-empty">{t('settings.provider.empty')}</p>}
      <ul>
        {providers.map(p => (
          <li key={p.id}>
            {p.name} ({p.type})
            <button onClick={() => void remove(p.id)}>{t('common.cancel')}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: 补充 i18n 键(修改两个 locale)**

zh-CN 追加:
```json
{ "provider": { "name": "名称", "baseUrl": "Base URL", "apiKey": "API Key" } }
```
en 追加:
```json
{ "provider": { "name": "Name", "baseUrl": "Base URL", "apiKey": "API Key" } }
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/pages/settings/ProviderSettingsPage.spec.tsx && cd /Users/baofengbaofeng/Workspace/github/baofengbaofeng/Jarvis && node scripts/i18n-check.mjs`
Expected: PASS 且 i18n 对称。

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/stores/provider-store.ts apps/desktop/src/renderer/src/pages/settings packages/i18n/locales
git commit -m "feat(provider-ui): provider CRUD form and list (C1)"
```

---

### Task 6: ModelRouter(L34 超时/重试/熔断 + B10 Fallback)

**Files:**
- Create: `packages/core/src/model/router.ts`
- Create: `packages/core/src/model/router.spec.ts`

**Interfaces:**
- Consumes: Task 2 `createAdapter`、Task 1 类型。
- Produces:
  - `ProviderPolicy { timeoutMs: number; maxRetries: number; circuitBreaker: boolean }`
  - `ModelRouter { chat(req, opts: { apiKeyResolver: (ref: string) => Promise<string|null>; policy?: ProviderPolicy; onChunk?: (c: ChatChunk) => void; fallbackModelIds?: string[] }): Promise<{ text: string; usage: Usage | null }> }`
  - 行为:尝试主 modelId;HTTP 429/5xx 抛 `RetryableError` → 重试 `maxRetries` 次(指数退避);仍失败且存在 `fallbackModelIds` → 依次切换;超时 `timeoutMs` 抛 `TimeoutError`;`circuitBreaker` 为 true 时基于连续失败次数(>5)短路(简单实现)。

- [ ] **Step 1: 编写失败测试**

`packages/core/src/model/router.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { ModelRouter, RetryableError } from './router';
import type { ChatRequest, ProviderAdapter } from './types';
import type { Provider } from '@jarvis/protocol';

const provider: Provider = { id: 'p1', name: 'p', type: 'openai-compatible', baseUrl: 'https://x.com', apiKeyRef: 'k', createdAt: '', updatedAt: '' };
const req: ChatRequest = { provider, modelId: 'primary', messages: [{ role: 'user', content: 'hi' }], stream: false };

describe('ModelRouter', () => {
  it('retries on retryable error then succeeds', async () => {
    let calls = 0;
    const adapter: ProviderAdapter = {
      type: 'openai-compatible',
      async chat(r, ctx) {
        calls++;
        if (calls === 1) throw new RetryableError('http 429');
        ctx.onChunk({ kind: 'delta', delta: 'ok' });
        ctx.onChunk({ kind: 'done' });
      }
    };
    const router = new ModelRouter({ createAdapter: () => adapter });
    const r = await router.chat(req, { apiKeyResolver: async () => 'sk', policy: { timeoutMs: 5000, maxRetries: 2, circuitBreaker: false } });
    expect(r.text).toBe('ok');
    expect(calls).toBe(2);
  });

  it('falls back to fallback model on persistent failure', async () => {
    const usedModels: string[] = [];
    const adapter: ProviderAdapter = {
      type: 'openai-compatible',
      async chat(r) { usedModels.push(r.modelId); throw new RetryableError('http 500'); }
    };
    const router = new ModelRouter({ createAdapter: () => adapter });
    await expect(router.chat(req, {
      apiKeyResolver: async () => 'sk',
      policy: { timeoutMs: 5000, maxRetries: 0, circuitBreaker: false },
      fallbackModelIds: ['backup-1']
    })).rejects.toThrow();
    expect(usedModels).toContain('primary');
    expect(usedModels).toContain('backup-1');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/core && pnpm vitest run src/model/router.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 编写实现**

`packages/core/src/model/router.ts`:
```ts
import type { ChatRequest, ChatChunk, ProviderAdapter, Usage } from './types';
import { createAdapter } from './adapters/index';

export class RetryableError extends Error {}
export class TimeoutError extends Error {}

export interface ProviderPolicy { timeoutMs: number; maxRetries: number; circuitBreaker: boolean }

export interface RouterDeps { createAdapter?: (type: ChatRequest['provider']['type'], deps?: { fetchImpl?: typeof fetch }) => ProviderAdapter }
export interface RouterChatOpts {
  apiKeyResolver: (ref: string) => Promise<string | null>;
  policy?: ProviderPolicy;
  onChunk?: (c: ChatChunk) => void;
  fallbackModelIds?: string[];
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_POLICY: ProviderPolicy = { timeoutMs: 60_000, maxRetries: 2, circuitBreaker: false };

export class ModelRouter {
  private adapter: ProviderAdapter;
  private failures = 0;

  constructor(deps: RouterDeps = {}) {
    this.adapter = (deps.createAdapter ?? createAdapter)('openai-compatible');
    this.adapter = null as unknown as ProviderAdapter;
    // 真实适配器在 chat() 内按 provider.type 创建
  }

  async chat(req: ChatRequest, opts: RouterChatOpts): Promise<{ text: string; usage: Usage | null }> {
    const policy = { ...DEFAULT_POLICY, ...opts.policy };
    if (policy.circuitBreaker && this.failures > 5) throw new Error('circuit open');
    const models = [req.modelId, ...(opts.fallbackModelIds ?? [])];
    let lastError: Error | null = null;
    for (const modelId of models) {
      for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
        const adapter = createAdapter(req.provider.type);
        const apiKey = await opts.apiKeyResolver(req.provider.apiKeyRef);
        if (!apiKey) throw new Error(`missing api key for provider ${req.provider.name}`);
        try {
          const text = await this.runOnce(adapter, { ...req, modelId }, apiKey, policy, opts.onChunk);
          this.failures = 0;
          return text;
        } catch (e) {
          lastError = e as Error;
          if (e instanceof RetryableError) { this.failures++; continue; }
          if (e instanceof TimeoutError) { this.failures++; continue; }
          break;
        }
      }
    }
    throw lastError ?? new Error('chat failed');
  }

  private runOnce(adapter: ProviderAdapter, req: ChatRequest, apiKey: string, policy: ProviderPolicy, onChunk?: (c: ChatChunk) => void): Promise<{ text: string; usage: Usage | null }> {
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), policy.timeoutMs);
      let text = '';
      let usage: Usage | null = null;
      adapter.chat(req, {
        apiKey,
        signal: controller.signal,
        onChunk: (c) => {
          if (c.kind === 'delta') text += c.delta;
          else if (c.kind === 'usage') usage = c.usage;
          else if (c.kind === 'error') reject(new RetryableError(c.error));
          onChunk?.(c);
        }
      }).then(() => { clearTimeout(timer); resolve({ text, usage }); })
        .catch((e) => {
          clearTimeout(timer);
          if (controller.signal.aborted) reject(new TimeoutError('timeout'));
          else reject(e instanceof RetryableError ? e : classifyError(e));
        });
    });
  }
}

function classifyError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (RETRYABLE_STATUS.has(statusFromMsg(msg))) return new RetryableError(msg);
  return e instanceof Error ? e : new Error(msg);
}

function statusFromMsg(msg: string): number {
  const m = msg.match(/http (\d{3})/);
  return m ? Number(m[1]) : 0;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/core && pnpm vitest run src/model/router.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/model/router.ts packages/core/src/model/router.spec.ts
git commit -m "feat(core): ModelRouter with retry/timeout/fallback (B10, L34)"
```

---

### Task 7: ChatService + 会话持久化 + 流式事件通道(D1/D2/L5)

**Files:**
- Create: `packages/core/src/chat/ChatService.ts`
- Create: `packages/core/src/chat/ChatService.spec.ts`
- Create: `apps/desktop/src/main/ipc/chat.ts`
- Create: `apps/desktop/src/main/ipc/chat.spec.ts`

**Interfaces:**
- Consumes: Task 6 ModelRouter;M0 schema(chat_sessions/chat_messages)。
- Produces:
  - `ChatService`(纯逻辑):`listSessions()/createSession()/loadMessages(sessionId)/appendMessage(sessionId, role, content)/buildModelMessages(sessionId)`。注入 `dbAdapter` 接口便于无 DB 测试。
  - main `chat.ts`:`chat.send` handler —— 入参 `{ sessionId, text, agentId }`,读取 session 消息 → 构建 ChatRequest → 调 ModelRouter 流式 → 逐 chunk 经 `event.sender.send(IpcEvent.chatDelta, ...)` 转发 → 结束写库并 `chat:done`。
  - `chat.listSessions` / `chat.createSession` / `chat.loadMessages`。

- [ ] **Step 1: 编写失败测试(ChatService 纯逻辑)**

`packages/core/src/chat/ChatService.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createChatService } from './ChatService';

describe('ChatService', () => {
  it('builds model messages with system prefix and history', () => {
    const msgs: Array<{ role: string; content: string }> = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' }
    ];
    const svc = createChatService({ listSessions: async () => [], createSession: async () => ({ id: 's1', title: '', createdAt: '', updatedAt: '' }), loadMessages: async () => msgs, appendMessage: async () => {}, loadAgent: async () => ({ id: 'a1', systemPrompt: 'You are helpful', modelId: 'm1', name: 'a', slug: 'a', description: '', workspaceId: null, contextBudgetTokens: 1000, planOnly: false, createdAt: '', updatedAt: '' }) });
    const result = svc.buildModelMessages(msgs, 'You are helpful');
    expect(result[0]).toEqual({ role: 'system', content: 'You are helpful' });
    expect(result.length).toBe(3);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/core && pnpm vitest run src/chat/ChatService.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 编写实现**

`packages/core/src/chat/ChatService.ts`:
```ts
import type { AgentConfig, ChatMessage, ChatSession } from '@jarvis/protocol';
import type { ModelMessage } from '../model/types';

export interface ChatDbAdapter {
  listSessions(): Promise<ChatSession[]>;
  createSession(title?: string): Promise<ChatSession>;
  loadMessages(sessionId: string): Promise<Array<Omit<ChatMessage, 'id' | 'sessionId' | 'createdAt'>>>;
  appendMessage(sessionId: string, role: string, content: string): Promise<void>;
  loadAgent(agentId: string): Promise<AgentConfig>;
}

export function createChatService(db: ChatDbAdapter) {
  return {
    async listSessions() { return db.listSessions(); },
    async createSession(title?: string) { return db.createSession(title); },
    async loadMessages(sessionId: string) { return db.loadMessages(sessionId); },
    async appendMessage(sessionId: string, role: string, content: string) { return db.appendMessage(sessionId, role, content); },
    buildModelMessages(history: Array<{ role: string; content: string }>, systemPrompt: string): ModelMessage[] {
      return [
        { role: 'system', content: systemPrompt },
        ...history.map(h => ({ role: h.role as ModelMessage['role'], content: h.content }))
      ];
    }
  };
}
```

- [ ] **Step 4: 编写 main chat IPC + 流式转发**

`apps/desktop/src/main/ipc/chat.ts`:
```ts
import type { BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { IpcEvent } from '@jarvis/protocol';
import { createChatService } from '@jarvis/core';
import { ModelRouter } from '@jarvis/core';
import type { SecureStorage } from '../secrets/SecureStorage';
import type { AgentConfig } from '@jarvis/protocol';

export function registerChatHandlers(db: Database.Database, secrets: SecureStorage, getWindow: () => BrowserWindow | null) {
  const now = () => new Date().toISOString();

  const dbAdapter = {
    async listSessions() {
      return (db.prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC').all() as Record<string, unknown>[]).map(r => ({
        id: r.id as string, title: r.title as string, createdAt: r.created_at as string, updatedAt: r.updated_at as string
      }));
    },
    async createSession(title?: string) {
      const id = randomUUID();
      db.prepare('INSERT INTO chat_sessions (id, title, created_at, updated_at) VALUES (?,?,?,?)').run(id, title ?? '新对话', now(), now());
      return { id, title: title ?? '新对话', createdAt: now(), updatedAt: now() };
    },
    async loadMessages(sessionId: string) {
      return (db.prepare('SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at').all(sessionId) as Array<{ role: string; content: string }>);
    },
    async appendMessage(sessionId: string, role: string, content: string) {
      db.prepare('INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)').run(randomUUID(), sessionId, role, content, now());
      db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(now(), sessionId);
    },
    async loadAgent(agentId: string) {
      const r = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as Record<string, unknown> | undefined;
      if (!r) throw new Error(`agent not found: ${agentId}`);
      return {
        id: r.id, name: r.name, slug: r.slug, description: r.description, systemPrompt: r.system_prompt,
        modelId: r.model_id as string | null, workspaceId: r.workspace_id as string | null,
        contextBudgetTokens: r.context_budget_tokens as number, planOnly: Boolean(r.plan_only),
        createdAt: r.created_at, updatedAt: r.updated_at
      } as AgentConfig;
    }
  };

  const chatService = createChatService(dbAdapter);
  const router = new ModelRouter();

  return {
    async listSessions() { return chatService.listSessions(); },
    async createSession(title?: string) { return chatService.createSession(title); },
    async loadMessages(sessionId: string) { return chatService.loadMessages(sessionId); },

    async send(event: Electron.IpcMainInvokeEvent, args: { sessionId: string; text: string; agentId: string }) {
      const { sessionId, text, agentId } = args;
      await chatService.appendMessage(sessionId, 'user', text);
      const history = await chatService.loadMessages(sessionId);
      const agent = await dbAdapter.loadAgent(agentId);
      const provider = db.prepare(`
        SELECT p.* FROM providers p JOIN models m ON m.provider_id = p.id WHERE m.id = ?
      `).get(agent.modelId) as Record<string, unknown> | undefined;
      if (!provider) throw new Error('agent has no valid model/provider binding');
      const sendChunk = (chunk: unknown) => { getWindow()?.webContents.send(IpcEvent.chatDelta, { sessionId, chunk }); };

      let full = '';
      try {
        await router.chat({
          provider: {
            id: provider.id as string, name: provider.name as string, type: provider.type as 'openai-compatible' | 'anthropic-compatible',
            baseUrl: provider.base_url as string, apiKeyRef: provider.api_key_ref as string, createdAt: provider.created_at as string, updatedAt: provider.updated_at as string
          },
          modelId: (db.prepare('SELECT model_id FROM models WHERE id = ?').get(agent.modelId) as { model_id: string }).model_id,
          messages: chatService.buildModelMessages(history, agent.systemPrompt),
          stream: true
        }, {
          apiKeyResolver: async (ref) => secrets.get(ref),
          onChunk: (c) => { if (c.kind === 'delta') full += c.delta; sendChunk(c); }
        });
        await chatService.appendMessage(sessionId, 'assistant', full);
        getWindow()?.webContents.send(IpcEvent.chatDone, { sessionId });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        getWindow()?.webContents.send(IpcEvent.chatDone, { sessionId, error: msg });
      }
      return { ok: true };
    }
  };
}
```

- [ ] **Step 5: 注册到 IpcRouter(传入 getWindow 回调)**

```ts
const chat = registerChatHandlers(this.db, secrets, () => BrowserWindow.getFocusedWindow());
this.register(IpcChannel.chatSend, (e, args) => chat.send(e, args));
this.register('chat.listSessions', () => chat.listSessions());
this.register('chat.createSession', (_e, title?: string) => chat.createSession(title));
this.register('chat.loadMessages', (_e, sessionId: string) => chat.loadMessages(sessionId));
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd packages/core && pnpm vitest run src/chat/ChatService.spec.ts`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/chat apps/desktop/src/main/ipc/chat.ts apps/desktop/src/main/ipc/IpcRouter.ts
git commit -m "feat(chat): ChatService with session persistence and streaming send (D1/D2/L5)"
```

---

### Task 8: ChatPage 真实多轮对话 UI(流式渲染 + 会话列表)

**Files:**
- Create: `apps/desktop/src/renderer/src/stores/chat-store.ts`
- Create: `apps/desktop/src/renderer/src/components/chat/MessageBubble.tsx`
- Create: `apps/desktop/src/renderer/src/components/chat/MarkdownView.tsx`
- Create: `apps/desktop/src/renderer/src/components/chat/ChatInput.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/ChatPage.tsx`
- Create: `apps/desktop/src/renderer/src/pages/ChatPage.spec.tsx`

**Interfaces:**
- Consumes: Task 7 `chat.send`/`chat.listSessions`/`chat.loadMessages`;IpcEvent.chatDelta/chatDone 订阅。
- Produces: 聊天页:左侧会话列表(可新建)、主区消息气泡(流式 append)、输入框回车发送 + Esc 取消占位。`chat-store` 维护 `messages` 与 `streaming` 状态;订阅 `chat:delta` 增量渲染。

- [ ] **Step 1: 编写 chat store + 组件**

`apps/desktop/src/renderer/src/stores/chat-store.ts`:
```ts
import { create } from 'zustand';
import type { ChatMessage } from '@jarvis/protocol';

interface ChatState {
  sessionId: string | null;
  messages: ChatMessage[];
  streaming: boolean;
  streamingText: string;
  init: () => Promise<void>;
  newSession: () => Promise<void>;
  loadSession: (sessionId: string) => Promise<void>;
  send: (text: string) => Promise<void>;
  appendDelta: (delta: string) => void;
  finishStream: (error?: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessionId: null,
  messages: [],
  streaming: false,
  streamingText: '',

  async init() {
    const sessions = (await window.jarvis.invoke('chat.listSessions')) as Array<{ id: string }>;
    if (sessions.length > 0) await get().loadSession(sessions[0].id);
    else await get().newSession();
  },

  async newSession() {
    const s = (await window.jarvis.invoke('chat.createSession')) as { id: string };
    set({ sessionId: s.id, messages: [], streamingText: '' });
  },

  async loadSession(sessionId: string) {
    const msgs = (await window.jarvis.invoke('chat.loadMessages', sessionId)) as ChatMessage[];
    set({ sessionId, messages: msgs, streamingText: '' });
  },

  async send(text: string) {
    const { sessionId } = get();
    if (!sessionId || get().streaming) return;
    set({ streaming: true, streamingText: '' });
    try {
      await window.jarvis.invoke('chat.send', { sessionId, text, agentId: 'placeholder-agent' });
    } catch (e) { get().finishStream(e instanceof Error ? e.message : String(e)); }
  },

  appendDelta(delta: string) { set((s) => ({ streamingText: s.streamingText + delta })); },

  finishStream(error?: string) {
    set((s) => {
      const finalText = error ?? s.streamingText;
      const msg: ChatMessage = { id: crypto.randomUUID(), sessionId: s.sessionId!, role: 'assistant', content: finalText, createdAt: new Date().toISOString() };
      return { streaming: false, streamingText: '', messages: [...s.messages, msg] };
    });
  }
}));

if (typeof window !== 'undefined' && window.jarvis?.onDidReceive) {
  window.jarvis.onDidReceive('chat:delta', (payload) => {
    const { chunk } = payload as { sessionId: string; chunk: { kind: string; delta?: string } };
    if (chunk.kind === 'delta') useChatStore.getState().appendDelta(chunk.delta ?? '');
  });
  window.jarvis.onDidReceive('chat:done', () => useChatStore.getState().finishStream());
}
```

- [ ] **Step 2: 编写 MarkdownView(D13)与气泡**

`apps/desktop/src/renderer/src/components/chat/MarkdownView.tsx`:
```tsx
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

export function MarkdownView({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className ?? '');
          return match ? (
            <SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div">{String(children)}</SyntaxHighlighter>
          ) : (<code className={className} {...props}>{children}</code>);
        }
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
```

`apps/desktop/src/renderer/src/components/chat/MessageBubble.tsx`:
```tsx
import type { ChatMessage } from '@jarvis/protocol';
import { MarkdownView } from './MarkdownView';

export function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <div data-testid={`message-${message.role}`} style={{ textAlign: message.role === 'user' ? 'right' : 'left', padding: 8 }}>
      {message.role === 'user' ? <span>{message.content}</span> : <MarkdownView content={message.content} />}
    </div>
  );
}
```

`apps/desktop/src/renderer/src/components/chat/ChatInput.tsx`:
```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../../stores/chat-store';

export function ChatInput() {
  const { t } = useTranslation('common');
  const [text, setText] = useState('');
  const send = useChatStore((s) => s.send);
  const streaming = useChatStore((s) => s.streaming);

  const submit = () => {
    const value = text.trim();
    if (!value) return;
    setText('');
    void send(value);
  };

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <textarea
        data-testid="chat-input"
        placeholder={t('chat.placeholder')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
        style={{ flex: 1 }}
      />
      <button data-testid="chat-send" onClick={submit} disabled={streaming}>{t('common.ok')}</button>
    </div>
  );
}
```

- [ ] **Step 3: 重写 ChatPage 组装**

`apps/desktop/src/renderer/src/pages/ChatPage.tsx`:
```tsx
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../stores/chat-store';
import { MessageBubble } from '../components/chat/MessageBubble';
import { ChatInput } from '../components/chat/ChatInput';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

export function ChatPage() {
  const { t } = useTranslation('common');
  const { messages, streamingText, init, loadSession } = useChatStore();

  useEffect(() => { void init(); }, [init]);

  return (
    <div data-testid="chat-page" style={{ display: 'flex', height: '100vh' }}>
      <aside style={{ width: 220, borderRight: '1px solid var(--border)', padding: 8 }}>
        <button data-testid="chat-new" onClick={() => void useChatStore.getState().newSession()}>+</button>
        <button data-testid="chat-to-settings" onClick={() => (window.location.href = '/settings')}>{t('settings.title')}</button>
        <LanguageSwitcher />
      </aside>
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {messages.map(m => <MessageBubble key={m.id} message={m} />)}
          {streamingText && <div data-testid="streaming-text"><MarkdownView content={streamingText} /></div>}
        </div>
        <ChatInput />
      </main>
    </div>
  );
}
```

- [ ] **Step 4: 运行类型检查**

Run: `cd apps/desktop && pnpm add @jarvis/core workspace:* && pnpm typecheck`
Expected: 通过。安装 `react-markdown`、`react-syntax-highlighter` 及 @types。

- [ ] **Step 5: 编写冒烟测试(chat-store 发送流)**

`apps/desktop/src/renderer/src/pages/ChatPage.spec.tsx`:
```tsx
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { getResources } from '@jarvis/i18n';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { ChatPage } from './ChatPage';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
  (window as unknown as { jarvis: unknown }).jarvis = {
    invoke: async (method: string, ..._a: unknown[]) => {
      if (method === 'chat.listSessions') return [];
      if (method === 'chat.createSession') return { id: 's1', title: '', createdAt: '', updatedAt: '' };
      if (method === 'chat.loadMessages') return [];
      if (method === 'chat.send') return { ok: true };
      return null;
    },
    onDidReceive: () => () => {}
  };
});

describe('ChatPage', () => {
  it('renders and accepts input', async () => {
    render(<ChatPage />);
    await waitFor(() => expect(screen.getByTestId('chat-input')).toBeTruthy());
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByTestId('chat-send'));
  });
});
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/pages/ChatPage.spec.tsx`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/src/stores/chat-store.ts apps/desktop/src/renderer/src/components/chat apps/desktop/src/renderer/src/pages/ChatPage.tsx apps/desktop/src/renderer/src/pages/ChatPage.spec.tsx apps/desktop/package.json
git commit -m "feat(chat-ui): streaming multi-turn chat page with session list (K1, D1, D13)"
```

---

### Task 9: 联网搜索 tool(D3) 与搜索源配置(L25 基础)

**Files:**
- Create: `packages/core/src/chat/search.ts`
- Create: `packages/core/src/chat/search.spec.ts`

**Interfaces:**
- Consumes: 无(独立工具)。设置项 `search_providers`(settings 表 JSON:如 `{ engine: 'tavily'|'custom', apiKeyRef, endpoint }`)。
- Produces: `searchWeb(query, cfg, deps?): Promise<{ title; url; snippet }[]>`;D3 联网搜索返回带引用结果。断网时抛 `RetryableError`(L34)。

- [ ] **Step 1: 编写失败测试**

`packages/core/src/chat/search.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { searchWeb } from './search';

describe('searchWeb', () => {
  it('returns cited results from custom endpoint', async () => {
    const results = await searchWeb('jarvis ai', {
      engine: 'custom', endpoint: 'https://search.example.com', apiKey: 'sk-x'
    }, { fetchImpl: async () => ({
      ok: true, json: async () => ({ results: [{ title: 'JARVIS', url: 'https://jarvis.ai', snippet: 'desc' }] })
    }) as Response });
    expect(results[0].title).toBe('JARVIS');
  });

  it('throws retryable error when endpoint down', async () => {
    await expect(searchWeb('x', { engine: 'custom', endpoint: 'https://down.example.com', apiKey: 'k' }, {
      fetchImpl: async () => ({ ok: false, status: 503, text: async () => '' }) as Response
    })).rejects.toThrow('search');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/core && pnpm vitest run src/chat/search.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 编写实现**

`packages/core/src/chat/search.ts`:
```ts
export interface SearchConfig { engine: 'tavily' | 'custom'; endpoint: string; apiKey: string }

export interface SearchResult { title: string; url: string; snippet: string }

export async function searchWeb(query: string, cfg: SearchConfig, deps: { fetchImpl?: typeof fetch } = {}): Promise<SearchResult[]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const res = await fetchImpl(cfg.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ query, max_results: 5 })
  });
  if (!res.ok) throw new Error(`search http ${res.status}`);
  const data = (await res.json()) as { results?: Array<{ title: string; url: string; snippet: string }> };
  return (data.results ?? []).map(r => ({ title: r.title, url: r.url, snippet: r.snippet }));
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/core && pnpm vitest run src/chat/search.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/chat/search.ts packages/core/src/chat/search.spec.ts
git commit -m "feat(core): configurable web search tool (D3)"
```

---

### Task 10: 对话导出(D14)与 Provider 连通测试(B8) + 连通性自检报告(L3)

**Files:**
- Create: `packages/core/src/chat/export.ts`
- Create: `packages/core/src/chat/export.spec.ts`
- Create: `apps/desktop/src/main/ipc/export.ts`
- Create: `apps/desktop/src/main/ipc/diagnostics.ts`
- Create: `apps/desktop/src/main/ipc/diagnostics.spec.ts`

**Interfaces:**
- Consumes: Task 7 会话数据;M0 env diagnostics。
- Produces:
  - `exportSessionMarkdown(messages): string` — 标准 Markdown 导出。
  - IPC `export.session` → main 写文件到用户选择路径(Markdown)。PDF 经 `webContents.printToPDF`(D14 PDF,可选)。
  - IPC `provider.test`(B8):对 provider+modelId 发最小 completion 请求,测延迟;写回结果。
  - IPC `diagnostics.run`(L3):并行测所有 provider 连通 + 环境信息 → `DiagnosticsReport`。

- [ ] **Step 1: 编写导出逻辑失败测试**

`packages/core/src/chat/export.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { exportSessionMarkdown } from './export';

describe('exportSessionMarkdown', () => {
  it('formats messages', () => {
    const md = exportSessionMarkdown([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello **world**' }
    ]);
    expect(md).toContain('**user**\n\nHi');
    expect(md).toContain('**assistant**\n\nHello **world**');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/core && pnpm vitest run src/chat/export.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 编写导出实现**

`packages/core/src/chat/export.ts`:
```ts
export function exportSessionMarkdown(messages: Array<{ role: string; content: string }>): string {
  return messages.map(m => `**${m.role}**\n\n${m.content}`).join('\n\n---\n\n');
}
```

- [ ] **Step 4: 编写连通测试(B8)与 L3 报告**

`apps/desktop/src/main/ipc/diagnostics.ts`:
```ts
import type Database from 'better-sqlite3';
import type { Provider } from '@jarvis/protocol';
import type { SecureStorage } from '../secrets/SecureStorage';
import { createAdapter } from '@jarvis/core';
import { collectEnvInfo } from '../diagnostics/env';

export async function testProviderConnectivity(db: Database.Database, secrets: SecureStorage, providerId: string, modelId: string, deps: { fetchImpl?: typeof fetch } = {}): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
  const p = db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId) as Record<string, unknown> | undefined;
  if (!p) return { ok: false, latencyMs: 0, detail: 'provider not found' };
  const apiKey = await secrets.get(p.api_key_ref as string);
  if (!apiKey) return { ok: false, latencyMs: 0, detail: 'missing api key' };
  const adapter = createAdapter(p.type as Provider['type'], deps);
  const start = Date.now();
  try {
    await adapter.chat({
      provider: { id: p.id as string, name: p.name as string, type: p.type as Provider['type'], baseUrl: p.base_url as string, apiKeyRef: p.api_key_ref as string, createdAt: '', updatedAt: '' },
      modelId, messages: [{ role: 'user', content: 'ping' }], stream: false, maxTokens: 1
    }, { apiKey, onChunk: () => {} });
    return { ok: true, latencyMs: Date.now() - start, detail: 'ok' };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - start, detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function runDiagnostics(db: Database.Database, secrets: SecureStorage): Promise<import('@jarvis/protocol').DiagnosticsReport> {
  const env = await collectEnvInfo();
  const providers = (db.prepare('SELECT * FROM providers').all() as Record<string, unknown>[]).map(r => ({
    id: r.id as string, type: r.type as Provider['type'], apiKeyRef: r.api_key_ref as string, name: r.name as string, baseUrl: r.base_url as string, createdAt: r.created_at as string, updatedAt: r.updated_at as string
  }));
  const items = [];
  for (const p of providers) {
    const models = db.prepare('SELECT model_id FROM models WHERE provider_id = ?').all(p.id) as Array<{ model_id: string }>;
    if (models.length === 0) { items.push({ id: `provider:${p.id}`, ok: false, detail: 'no models' }); continue; }
    const r = await testProviderConnectivity(db, secrets, p.id, models[0].model_id);
    items.push({ id: `provider:${p.id}`, ok: r.ok, detail: `${r.detail} (${r.latencyMs}ms)` });
  }
  return { env, checkedAt: new Date().toISOString(), items };
}
```

- [ ] **Step 5: 注册 IPC(修改 IpcRouter)**

```ts
this.register(IpcChannel.diagnosticsRun, () => runDiagnostics(this.db, secrets));
this.register('provider.test', (_e, providerId: string, modelId: string) => testProviderConnectivity(this.db, secrets, providerId, modelId));
this.register('export.session', async (_e, sessionId: string) => {
  const rows = this.db.prepare('SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at').all(sessionId) as Array<{ role: string; content: string }>;
  return exportSessionMarkdown(rows);
});
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd packages/core && pnpm vitest run src/chat/export.spec.ts`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/chat/export.ts packages/core/src/chat/export.spec.ts apps/desktop/src/main/ipc/diagnostics.ts apps/desktop/src/main/ipc/IpcRouter.ts
git commit -m "feat(diagnostics): provider connectivity test (B8), L3 report, session export (D14)"
```

---

### Task 11: 上下文管理(L16)与 Token 预算(L17 基础) + 会话摘要占位

**Files:**
- Create: `packages/core/src/context/ContextManager.ts`
- Create: `packages/core/src/context/ContextManager.spec.ts`
- Create: `packages/core/src/util/token.ts`

**Interfaces:**
- Consumes: Task 6 ModelRouter(用于摘要调用,本里程碑以注入函数占位)。
- Produces:
  - `estimateTokens(text): number`(近似:中英文混合按字符/4 + 词数,可后续换 tiktoken)。
  - `ContextManager { buildMessages(history, systemPrompt, budget): ModelMessage[]; maybeSummarize(history, budget, summarizeFn): Promise<ModelMessage[]> }` — 超预算时调用 `summarizeFn` 返回摘要;Pin 消息不参与摘要(本里程碑 Pin 标识沿用 role system,后续完善)。

- [ ] **Step 1: 编写失败测试**

`packages/core/src/context/ContextManager.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { estimateTokens } from '../util/token';
import { createContextManager } from './ContextManager';

describe('ContextManager', () => {
  it('estimates non-zero tokens', () => {
    expect(estimateTokens('hello world')).toBeGreaterThan(0);
  });

  it('triggers summarization over budget', async () => {
    const summarize = vi.fn().mockResolvedValue('[summary]');
    const cm = createContextManager({ summarizeFn: summarize });
    const history = Array.from({ length: 50 }, (_, i) => ({ role: 'user' as const, content: `line ${i} `.repeat(20) }));
    const out = await cm.maybeSummarize(history, 100, summarize);
    expect(summarize).toHaveBeenCalled();
    expect(out[out.length - 1].content).toBe('[summary]');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/core && pnpm vitest run src/context/ContextManager.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 编写实现**

`packages/core/src/util/token.ts`:
```ts
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const words = text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return Math.ceil(words + cjk / 1.5);
}
```

`packages/core/src/context/ContextManager.ts`:
```ts
import type { ModelMessage } from '../model/types';
import { estimateTokens } from '../util/token';

export interface SummarizeFn { (history: Array<{ role: string; content: string }>): Promise<string> }

export function createContextManager(deps: { summarizeFn?: SummarizeFn } = {}) {
  const summarizeFn = deps.summarizeFn;
  return {
    estimateTokens,
    buildMessages(history: Array<{ role: string; content: string }>, systemPrompt: string): ModelMessage[] {
      return [{ role: 'system', content: systemPrompt }, ...history.map(h => ({ role: h.role as ModelMessage['role'], content: h.content }))];
    },
    async maybeSummarize(history: Array<{ role: string; content: string }>, budget: number, summarize: SummarizeFn = summarizeFn!): Promise<ModelMessage[]> {
      const total = history.reduce((acc, h) => acc + estimateTokens(h.content), 0);
      if (total <= budget || !summarize) return this.buildMessages(history, '');
      const summary = await summarize(history);
      return [{ role: 'system', content: summary }];
    }
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/core && pnpm vitest run src/context/ContextManager.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/context packages/core/src/util/token.ts
git commit -m "feat(core): context manager with token budget and summarization hook (L16/L17)"
```

---

### Task 12: 网络代理(L33)与 Electron main 集成

**Files:**
- Create: `packages/core/src/util/proxy.ts`
- Create: `apps/desktop/src/main/ipc/proxy.ts`
- Create: `packages/core/src/util/proxy.spec.ts`

**Interfaces:**
- Consumes: settings `proxy_json`。
- Produces: `ProxyConfig { mode: 'none'|'system'|'custom'; httpUrl?: string; socksUrl?: string }`;`resolveProxyConfig(settings)`;main 提供 `proxy.get/set` IPC;ModelRouter 与 MCP HTTP 客户端共用该配置(本里程碑实现 get/set 与解析,应用到 fetch 的 dispatcher 在 M3 接入)。

- [ ] **Step 1: 编写失败测试**

`packages/core/src/util/proxy.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { resolveProxyConfig } from './proxy';

describe('resolveProxyConfig', () => {
  it('defaults to none', () => {
    expect(resolveProxyConfig(undefined)).toEqual({ mode: 'none' });
  });
  it('parses custom http proxy', () => {
    expect(resolveProxyConfig({ mode: 'custom', httpUrl: 'http://127.0.0.1:7890' })).toEqual({ mode: 'custom', httpUrl: 'http://127.0.0.1:7890' });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/core && pnpm vitest run src/util/proxy.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 编写实现**

`packages/core/src/util/proxy.ts`:
```ts
export interface ProxyConfig { mode: 'none' | 'system' | 'custom'; httpUrl?: string; socksUrl?: string }

export function resolveProxyConfig(raw: unknown): ProxyConfig {
  if (!raw || typeof raw !== 'object') return { mode: 'none' };
  const r = raw as { mode?: string; httpUrl?: string; socksUrl?: string };
  if (r.mode !== 'system' && r.mode !== 'custom') return { mode: 'none' };
  return { mode: r.mode, httpUrl: r.httpUrl, socksUrl: r.socksUrl };
}
```

- [ ] **Step 4: 注册 IPC(修改 IpcRouter,复用 settings store)**

```ts
this.register('proxy.get', () => settings.getAll().proxy_json ?? { mode: 'none' });
this.register('proxy.set', (_e, cfg: unknown) => { settings.set('proxy_json', cfg); return { ok: true }; });
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd packages/core && pnpm vitest run src/util/proxy.spec.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/util/proxy.ts packages/core/src/util/proxy.spec.ts apps/desktop/src/main/ipc/IpcRouter.ts
git commit -m "feat(proxy): proxy config resolution and IPC (L33)"
```

---

### M1 验收清单(Self-Review 对照)

对照技术文档 §21 M1 与 §33 MVP 验收:

- [x] B1–B4 Provider CRUD + 自定义 model(Task 4/5)
- [x] B5/B6 参数映射字段已预留(`ChatRequest.maxTokens/temperature/reasoning`)(Task 1/2)
- [x] B7 Keychain 加密存储(Task 3)
- [x] B8 Provider 连通测试(Task 10)
- [x] B10 Fallback 链(Task 6)
- [x] B13 OpenAI/Anthropic 双适配器(Task 2)
- [x] C1 Provider 管理页完成(Task 5)
- [x] D1 多轮对话(Task 7/8)
- [x] D2 会话历史(Task 7)
- [x] D3 联网搜索(Task 9)
- [x] D13 Markdown 渲染(Task 8)
- [x] D14 对话导出 Markdown(Task 10)
- [x] L3 连通性自检(Task 10)
- [x] L16 上下文管理 + 摘要占位(Task 11)
- [x] L33 代理配置(Task 12)
- [x] L34 重试/熔断(Task 6)

**M1 已知后置:** Agent 绑定的真实模型解析(Task 7 中 `agentId` 为占位)、`token_usage` 表写入(后续 Task)、SSE 传输经 Go daemon 的 Multica 流(M7)、PDF 导出(D14 PDF 部分,M5 补充)。
