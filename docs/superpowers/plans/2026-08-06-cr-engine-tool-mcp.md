# Engine、Tool 与 MCP 协议整改 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 BP-02、BP-03、BP-04、BP-05、BP-06 与 REQ-06，使 OpenAI/Anthropic 工具循环、ModelRouter 业务主路径、每 run 工具授权和 MCP 进程生命周期都具备真实可重复的回归证据。

**Architecture:** `packages/core` 以 `AssistantToolTurn` / `ToolResultTurn` 作为唯一 provider-neutral 工具消息协议，adapter 只负责供应商格式映射，`AgentEngine` 负责按完整 turn 推进 REACT loop。Electron main 只解析持久化配置并把不可变的模型 fallback 与工具授权快照传入 run；MCP transport 负责字节帧和子进程事件，`McpClient` 负责 request timeout、abort 与 pending 清理。

**Tech Stack:** TypeScript 5、Node 20 `fetch`/`http`/`AbortController`/`child_process`、Vitest 2、Electron main、better-sqlite3。

## Global Constraints

- 只修改本计划 File Map 中列出的文件；不得重写 Go 版 engine、router 或 MCP client。
- `AgentEngine`、REACT loop、`ModelRouter`、`MCPClient` 的唯一实现继续位于 `packages/core` TypeScript。
- Provider/model ID 完全由用户定义；测试只使用 `model-primary`、`model-backup` 等 fixture，不加入生产默认 model ID。
- API Key 只由 `SecureStorage` 解析；数据库、日志、测试快照均不得保存明文 key。
- SQLite 迁移只追加 v13，不修改 v1–v12。
- Renderer 只能导入 `@jarvis/core/renderer`；本计划新增的 Node-dependent 类型与实现只从 `@jarvis/core` full barrel 导出。
- 所有 run-scoped 数组与集合在进入 engine 前复制并冻结；运行中注册新工具或启动另一个 Agent 不得改变既有 run 的可见/可执行工具。
- ModelRouter 只重试网络错误、HTTP 429 与 5xx；收到 tool call 后的工具副作用不由 router 自动重放。
- MCP 默认 request timeout 为 `30_000ms`，默认最大 stdout JSON frame 为 `1_048_576` bytes；initialize/list/call 均允许调用方覆盖 timeout 并传入 `AbortSignal`。
- 每个 Task 严格执行 Red → Green → Refactor，并只暂存该 Task 明列文件；提交前运行 `git diff --cached --check`。
- 本计划不新增依赖。

---

## File Map

### Provider-neutral 消息与 adapter

- Modify: `packages/core/src/model/types.ts` — 定义 `AssistantToolTurn`、`ToolResultTurn`、`ModelMessage` union 与类型守卫。
- Modify: `packages/core/src/model/types.spec.ts` — 固化 structured turn 不变量。
- Modify: `packages/core/src/model/adapters/openai.ts` — 中立 turn ↔ OpenAI `tool_calls` / `tool_call_id` 映射。
- Modify: `packages/core/src/model/adapters/anthropic.ts` — 中立 turn ↔ Anthropic `tool_use` / `tool_result` 映射及 streaming 累积。
- Modify: `packages/core/src/model/adapters/adapters.spec.ts` — adapter 请求体和 Anthropic stream 精确断言。
- Create: `packages/core/src/model/tool-loop.integration.spec.ts` — Node 本地 HTTP server 上的 OpenAI/Anthropic 真实两轮工具循环。

### Engine 与 ModelRouter 主路径

- Modify: `packages/core/src/agent/AgentEngine.ts` — 保存完整 assistant tool turn，追加带 call ID 的 result turn，并在 run 开始捕获授权视图。
- Modify: `packages/core/src/agent/AgentEngine.spec.ts` — turn 顺序、call ID、错误结果和并发授权测试。
- Modify: `packages/core/src/agent/ToolRegistry.ts` — 生成不可变 `AuthorizedToolView`。
- Modify: `packages/core/src/agent/ToolRegistry.spec.ts` — allowlist、agent identity 与快照不变性测试。
- Modify: `packages/core/src/agent/types.ts` — `ToolAuthorization` / `AuthorizedToolView` 接口。
- Modify: `packages/core/src/model/router.ts` — provider-aware fallback targets、外部取消、timeout 与 jitter backoff。
- Modify: `packages/core/src/model/router.spec.ts` — fallback、retry 分类、外部 abort 测试。
- Modify: `packages/core/src/task/TaskOrchestrator.ts` — 将 run-scoped authorization/fallback 原样传入 engine。
- Modify: `apps/desktop/src/main/ipc/task-engine-factory.ts` — Task 默认 chat 主路径改走 `ModelRouter`。
- Modify: `apps/desktop/src/main/ipc/tasks.ts` — 构造 run-scoped model route 与 tool authorization。
- Modify: `apps/desktop/src/main/ipc/tasks.spec.ts` — Task 主路径 retry/fallback 与并发工具隔离。
- Modify: `apps/desktop/src/main/ipc/chat.ts` — Chat 使用统一 model route。
- Modify: `apps/desktop/src/main/ipc/chat.spec.ts` — Chat fallback 传递测试。
- Modify: `apps/desktop/src/main/ipc/office.ts` — Office stream bridge 改走 `ModelRouter`。
- Modify: `apps/desktop/src/main/ipc/office.spec.ts` — Office router 调用、timeout/abort 透传测试。
- Create: `apps/desktop/src/main/ipc/model-route.ts` — 从 main-owned DB 解析主模型及 fallback targets。
- Create: `apps/desktop/src/main/ipc/model-route.spec.ts` — 顺序、跨 provider、缺失记录测试。

### Fallback 持久化

- Modify: `apps/desktop/src/main/db/migrations.ts` — append v13 `agents.fallback_model_ids_json`。
- Modify: `apps/desktop/src/main/db/migrations.spec.ts` — 新旧数据库迁移断言。
- Modify: `packages/protocol/src/index.ts` — `AgentConfig.fallbackModelIds: string[]`。
- Modify: `apps/desktop/src/main/ipc/agents.ts` — CRUD 映射 fallback model row IDs。
- Modify: `apps/desktop/src/main/ipc/agents.spec.ts` — fallback round-trip。
- Modify: `apps/desktop/src/renderer/src/pages/AgentDetailPage.tsx` — 用户模型多选，不写死 model。
- Modify: `apps/desktop/src/renderer/src/pages/AgentListView.spec.tsx` — fallback 保存 payload。
- Modify: `packages/i18n/locales/zh-CN/common.json`
- Modify: `packages/i18n/locales/en/common.json`

### MCP 生命周期与授权接线

- Modify: `packages/core/src/mcp/transport.ts` — data-buffer framing、frame 上限、error/exit/close 通知。
- Modify: `packages/core/src/mcp/McpClient.ts` — timeout、AbortSignal、pending 统一 finalize。
- Modify: `packages/core/src/mcp/McpClient.spec.ts` — timeout/abort/exit/error/oversize/close 清理。
- Modify: `packages/core/src/mcp/register.ts` — 返回该 server 注册的完整工具名。
- Modify: `apps/desktop/src/main/ipc/mcp.ts` — 返回指定 Agent 本次获准的 MCP 工具名，不把全局 registry 当授权来源。
- Modify: `apps/desktop/src/main/ipc/mcp.spec.ts` — 两 Agent 绑定隔离与失败 child 回收。
- Modify: `packages/core/src/index.ts` — 导出新增 core 类型。

---

## CR Traceability

- **BP-02:** Task 5。Task/Chat/Office 统一调用 `ModelRouter.chat`；v13 + Agent UI 提供真实 fallback chain；主路径测试覆盖 429 → retry → 跨 provider fallback。
- **BP-03:** Task 6。全局 registry 只保存定义/handler，`AuthorizedToolView` 按 run 的 agent 与 MCP binding 拒绝越权执行。
- **BP-04:** Task 7。MCP request timeout、AbortSignal、1 MiB frame、child `error`/`exit`/主动 close 全部 reject pending 并移除 listener/timer。
- **BP-05:** Task 6。删除共享 `visibleTools`，`EngineRunInput.toolAuthorization` 为冻结快照；并发 Plan/Edit Agent 测试证明不串扰。
- **BP-06:** Tasks 1–4。中立 structured turns 保留 call ID；两个 adapter 生成协议正确的第二轮请求；真实 HTTP mock 验证完整两轮。
- **REQ-06:** Task 3 和 Task 4。Anthropic 累积 `content_block_start(tool_use)` + 多个 `input_json_delta`，在 `content_block_stop` emit 工具调用并完成第二轮。

---

### Task 1: Provider-neutral Structured Tool Turns

**Files:**
- Modify: `packages/core/src/model/types.ts`
- Modify: `packages/core/src/model/types.spec.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: `AssistantToolTurn`, `ToolResultTurn`, `ModelMessage`, `isAssistantToolTurn`, `isToolResultTurn`。
- Invariant: 一个 `AssistantToolTurn` 可同时携带文本和多个 call；每个 `ToolResultTurn.toolCallId` 必须引用前一 assistant turn 的 call ID。

- [ ] **Step 1: 写失败测试**

在 `packages/core/src/model/types.spec.ts` 追加：

```ts
import {
  isAssistantToolTurn,
  isToolResultTurn,
  type AssistantToolTurn,
  type ToolResultTurn,
} from './types';

it('recognizes provider-neutral assistant and result turns without losing call ids', () => {
  const assistant: AssistantToolTurn = {
    role: 'assistant',
    content: 'I will inspect it.',
    toolCalls: [
      { id: 'call-a', name: 'read_file', arguments: { path: 'a.ts' } },
      { id: 'call-b', name: 'read_file', arguments: { path: 'b.ts' } },
    ],
  };
  const result: ToolResultTurn = {
    role: 'tool',
    toolCallId: 'call-b',
    name: 'read_file',
    content: 'export const b = 1;',
    isError: false,
  };

  expect(isAssistantToolTurn(assistant)).toBe(true);
  expect(isToolResultTurn(result)).toBe(true);
  expect(result.toolCallId).toBe(assistant.toolCalls[1].id);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/core && pnpm vitest run src/model/types.spec.ts`

Expected: FAIL，提示 `AssistantToolTurn` / `ToolResultTurn` 未导出。

- [ ] **Step 3: 实现最小中立协议**

将 `ModelMessage` 改为以下 union；保留现有 `MessageContent` 以免破坏多模态：

```ts
export interface SystemTurn {
  role: 'system';
  content: string;
}

export interface UserTurn {
  role: 'user';
  content: string | MessageContent;
  name?: string;
}

export interface AssistantTextTurn {
  role: 'assistant';
  content: string | MessageContent;
}

export interface AssistantToolTurn {
  role: 'assistant';
  content: string | MessageContent;
  toolCalls: readonly ToolCall[];
}

export interface ToolResultTurn {
  role: 'tool';
  toolCallId: string;
  name: string;
  content: string;
  isError: boolean;
}

export type ModelMessage =
  | SystemTurn
  | UserTurn
  | AssistantTextTurn
  | AssistantToolTurn
  | ToolResultTurn;

export function isAssistantToolTurn(message: ModelMessage): message is AssistantToolTurn {
  return message.role === 'assistant' && 'toolCalls' in message;
}

export function isToolResultTurn(message: ModelMessage): message is ToolResultTurn {
  return message.role === 'tool';
}
```

`ChatRequest.messages` 继续使用 `ModelMessage[]`；`ToolCall` 字段保持 `{ id, name, arguments }`。

- [ ] **Step 4: 运行测试和类型检查**

Run: `cd packages/core && pnpm vitest run src/model/types.spec.ts && pnpm typecheck`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/model/types.ts packages/core/src/model/types.spec.ts packages/core/src/index.ts
git diff --cached --check
git commit -m "feat: add provider-neutral structured tool turns"
```

---

### Task 2: OpenAI Structured Turn Mapping

**Files:**
- Modify: `packages/core/src/model/adapters/openai.ts`
- Modify: `packages/core/src/model/adapters/adapters.spec.ts`

**Interfaces:**
- Consumes: Task 1 `ModelMessage` union。
- Produces: `toOpenAIMessages(messages)`。
- Mapping: `AssistantToolTurn` → `assistant.tool_calls[]`；`ToolResultTurn` → `role:'tool' + tool_call_id + name`。

- [ ] **Step 1: 写失败测试**

在 OpenAI adapter describe 中追加：

```ts
it('serializes assistant tool calls and correlated tool results', async () => {
  let body!: {
    messages: Array<{
      role: string;
      content: unknown;
      tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
      tool_call_id?: string;
      name?: string;
    }>;
  };
  const adapter = createAdapter('openai-compatible', {
    fetchImpl: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return mockResponse(['data: [DONE]']);
    },
  });

  await adapter.chat(makeRequest('openai-compatible', [
    { role: 'user', content: 'read it' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call-17', name: 'read_file', arguments: { path: 'a.ts' } }],
    },
    {
      role: 'tool',
      toolCallId: 'call-17',
      name: 'read_file',
      content: 'file body',
      isError: false,
    },
  ]), { apiKey: 'test-key', onChunk: () => {} });

  expect(body.messages[1]).toEqual({
    role: 'assistant',
    content: '',
    tool_calls: [{
      id: 'call-17',
      type: 'function',
      function: { name: 'read_file', arguments: '{"path":"a.ts"}' },
    }],
  });
  expect(body.messages[2]).toEqual({
    role: 'tool',
    tool_call_id: 'call-17',
    name: 'read_file',
    content: 'file body',
  });
});
```

同时把现有 `mockFetch` 的 response 构造提取为 `mockResponse(lines): Response`，`makeRequest(type, messages)` 返回合法 `ChatRequest`。

- [ ] **Step 2: 运行失败测试**

Run: `cd packages/core && pnpm vitest run src/model/adapters/adapters.spec.ts -t "serializes assistant tool calls"`

Expected: FAIL；当前 request body 不含 `tool_calls` / `tool_call_id`。

- [ ] **Step 3: 实现 OpenAI 映射**

```ts
import {
  isAssistantToolTurn,
  isToolResultTurn,
  type ModelMessage,
} from '../types';

export function toOpenAIMessages(messages: ModelMessage[]): Record<string, unknown>[] {
  return messages.map((message) => {
    if (isAssistantToolTurn(message)) {
      return {
        role: 'assistant',
        content: normalizeContent(message.content, 'openai'),
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments),
          },
        })),
      };
    }
    if (isToolResultTurn(message)) {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        name: message.name,
        content: message.content,
      };
    }
    return {
      role: message.role,
      content: normalizeContent(message.content, 'openai'),
      ...('name' in message && message.name ? { name: message.name } : {}),
    };
  });
}
```

OpenAI request body 使用 `messages: toOpenAIMessages(req.messages)`。保留现有 streaming tool-call index 累积；JSON 解析失败时抛 `Error("invalid OpenAI tool arguments for <id>")`，不得静默改成 `{}`。

- [ ] **Step 4: 运行 adapter 全量测试**

Run: `cd packages/core && pnpm vitest run src/model/adapters/adapters.spec.ts && pnpm typecheck`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/model/adapters/openai.ts packages/core/src/model/adapters/adapters.spec.ts
git diff --cached --check
git commit -m "fix: map structured tool turns to OpenAI protocol"
```

---

### Task 3: Anthropic Mapping and Streaming `tool_use`

**Files:**
- Modify: `packages/core/src/model/adapters/anthropic.ts`
- Modify: `packages/core/src/model/adapters/adapters.spec.ts`

**Interfaces:**
- Produces: `toAnthropicMessages(messages)`。
- Streaming accumulator: `Map<number, { id: string; name: string; initialInput: Record<string, unknown>; partialJson: string }>`。
- Emit rule: 只在对应 `content_block_stop` 后 emit 一次 `{ kind:'tool_call' }`；`message_stop` 不重复 emit。

- [ ] **Step 1: 写失败测试**

```ts
it('maps assistant tool_use and the following user tool_result block', async () => {
  let body!: { messages: Array<{ role: string; content: unknown }> };
  const adapter = createAdapter('anthropic-compatible', {
    fetchImpl: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return mockResponse([
        'event: message_stop',
        'data: {"type":"message_stop"}',
      ]);
    },
  });
  await adapter.chat(makeRequest('anthropic-compatible', [
    {
      role: 'assistant',
      content: 'Checking.',
      toolCalls: [{ id: 'toolu_9', name: 'read_file', arguments: { path: 'a.ts' } }],
    },
    {
      role: 'tool',
      toolCallId: 'toolu_9',
      name: 'read_file',
      content: 'boom',
      isError: true,
    },
  ]), { apiKey: 'test-key', onChunk: () => {} });

  expect(body.messages).toEqual([
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Checking.' },
        { type: 'tool_use', id: 'toolu_9', name: 'read_file', input: { path: 'a.ts' } },
      ],
    },
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_9', content: 'boom', is_error: true }],
    },
  ]);
});

it('accumulates Anthropic tool_use input_json_delta and preserves usage', async () => {
  const adapter = createAdapter('anthropic-compatible', {
    fetchImpl: mockFetch([
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":11}}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_9","name":"read_file","input":{}}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"a.ts\\"}"}}',
      '',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":1}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","usage":{"output_tokens":7}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
    ]),
  });
  const chunks: ChatChunk[] = [];
  await adapter.chat(makeRequest('anthropic-compatible', [{ role: 'user', content: 'go' }]), {
    apiKey: 'test-key',
    onChunk: (chunk) => chunks.push(chunk),
  });
  expect(chunks.filter(c => c.kind === 'tool_call')).toEqual([{
    kind: 'tool_call',
    toolCalls: [{ id: 'toolu_9', name: 'read_file', arguments: { path: 'a.ts' } }],
  }]);
  expect(chunks.filter(c => c.kind === 'usage')).toEqual([{
    kind: 'usage',
    usage: { promptTokens: 11, completionTokens: 7, totalTokens: 18 },
  }]);
});
```

- [ ] **Step 2: 运行失败测试**

Run: `cd packages/core && pnpm vitest run src/model/adapters/adapters.spec.ts -t "Anthropic tool"`

Expected: FAIL；当前 adapter 既不映射 result，也不 emit `tool_call`。

- [ ] **Step 3: 实现 Anthropic 请求映射**

```ts
export function toAnthropicMessages(messages: ModelMessage[]): Array<{ role: 'user' | 'assistant'; content: unknown }> {
  const out: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];
  for (const message of messages.filter(m => m.role !== 'system')) {
    if (isAssistantToolTurn(message)) {
      const textBlocks = typeof message.content === 'string'
        ? (message.content ? [{ type: 'text', text: message.content }] : [])
        : normalizeContent(message.content, 'anthropic');
      out.push({
        role: 'assistant',
        content: [
          ...textBlocks,
          ...message.toolCalls.map(call => ({
            type: 'tool_use',
            id: call.id,
            name: call.name,
            input: call.arguments,
          })),
        ],
      });
    } else if (isToolResultTurn(message)) {
      const block = {
        type: 'tool_result',
        tool_use_id: message.toolCallId,
        content: message.content,
        is_error: message.isError,
      };
      const previous = out.at(-1);
      if (previous?.role === 'user' && Array.isArray(previous.content)
        && previous.content.every(x => (x as { type?: string }).type === 'tool_result')) {
        previous.content.push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
    } else {
      out.push({
        role: message.role as 'user' | 'assistant',
        content: normalizeContent(message.content, 'anthropic'),
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: 实现 streaming 累积**

在 SSE loop 前创建 `toolUse = new Map<number, ...>()`，并处理：

```ts
if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
  toolUse.set(event.index, {
    id: event.content_block.id,
    name: event.content_block.name,
    initialInput: event.content_block.input ?? {},
    partialJson: '',
  });
}
if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
  const acc = toolUse.get(event.index);
  if (!acc) throw new Error(`Anthropic input_json_delta without tool_use at index ${event.index}`);
  acc.partialJson += event.delta.partial_json ?? '';
}
if (event.type === 'content_block_stop') {
  const acc = toolUse.get(event.index);
  if (acc) {
    const args = acc.partialJson ? JSON.parse(acc.partialJson) : acc.initialInput;
    ctx.onChunk({ kind: 'tool_call', toolCalls: [{ id: acc.id, name: acc.name, arguments: args }] });
    toolUse.delete(event.index);
  }
}
```

再增加一个 `content_block_start.input={path:'direct.ts'}` 且没有 `input_json_delta` 的测试，断言最终 arguments 保留该对象。`message_start.message.usage.input_tokens` 和 `message_delta.usage.output_tokens` 继续汇总；遇到未关闭的 tool block 后 `message_stop` 必须抛错。

- [ ] **Step 5: 运行测试**

Run: `cd packages/core && pnpm vitest run src/model/adapters/adapters.spec.ts && pnpm typecheck`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/model/adapters/anthropic.ts packages/core/src/model/adapters/adapters.spec.ts
git diff --cached --check
git commit -m "fix: support Anthropic tool use streaming and results"
```

---

### Task 4: AgentEngine Structured Loop and Real Two-round HTTP Mocks

**Files:**
- Modify: `packages/core/src/agent/AgentEngine.ts`
- Modify: `packages/core/src/agent/AgentEngine.spec.ts`
- Create: `packages/core/src/model/tool-loop.integration.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–3 structured turns。
- Behavior: 每轮先 append 一个完整 `AssistantToolTurn`，再按 call 顺序 append `ToolResultTurn`；拒绝和 handler throw 也生成 `isError:true` result。

- [ ] **Step 1: 写 AgentEngine 失败测试**

```ts
it('sends the complete assistant tool turn and correlated result into round two', async () => {
  const requests: ChatRequest[] = [];
  const reg = new ToolRegistry();
  reg.register({ name: 'echo', description: '', parameters: {} }, async () => ({
    ok: true,
    output: 'tool output',
  }));
  let round = 0;
  const chat: EngineChatFn = async (req, opts) => {
    requests.push(structuredClone(req));
    round++;
    if (round === 1) {
      opts.onChunk?.({
        kind: 'tool_call',
        toolCalls: [{ id: 'call-44', name: 'echo', arguments: { value: 1 } }],
      });
      return { text: 'Calling echo.', usage: null };
    }
    return { text: 'finished', usage: null };
  };
  const engine = new AgentEngine({ modelRouter: { chat }, toolRegistry: reg });

  await engine.run(makeRunInput());

  expect(requests[1].messages.slice(-2)).toEqual([
    {
      role: 'assistant',
      content: 'Calling echo.',
      toolCalls: [{ id: 'call-44', name: 'echo', arguments: { value: 1 } }],
    },
    {
      role: 'tool',
      toolCallId: 'call-44',
      name: 'echo',
      content: 'tool output',
      isError: false,
    },
  ]);
});
```

另加 handler throw 断言：第二轮仍收到同一 ID、`content` 为安全错误文本、`isError:true`。

- [ ] **Step 2: 运行失败测试**

Run: `cd packages/core && pnpm vitest run src/agent/AgentEngine.spec.ts -t "complete assistant tool turn"`

Expected: FAIL；当前只 append 无 ID 的 `{role:'tool', content}`。

- [ ] **Step 3: 实现 loop turn 顺序**

```ts
const assistantTurn: AssistantToolTurn = {
  role: 'assistant',
  content: text,
  toolCalls: Object.freeze(callCalls.map(call => ({
    ...call,
    arguments: structuredClone(call.arguments),
  }))),
};
working.push(assistantTurn);

for (const call of assistantTurn.toolCalls) {
  let result: ToolResult;
  let isError = false;
  try {
    const approved = !this.cfg.approvalGate || await this.cfg.approvalGate({
      toolName: call.name,
      args: call.arguments,
      prompt: `run ${call.name}`,
      agent: input.agent,
    });
    if (!approved) {
      result = { ok: false, output: `[denied] ${call.name}` };
      isError = true;
    } else {
      result = await tools.execute(call, toolContext);
      isError = !result.ok;
    }
  } catch (error) {
    result = { ok: false, output: error instanceof Error ? error.message : String(error) };
    isError = true;
  }
  working.push({
    role: 'tool',
    toolCallId: call.id,
    name: call.name,
    content: result.output,
    isError,
  });
  onTool?.(call, result);
}
```

当本轮没有 tool call 时只 append `AssistantTextTurn` 并结束；不得同时 append text turn 和 tool turn 两次。

- [ ] **Step 4: 写真实两轮 HTTP integration test**

创建 `tool-loop.integration.spec.ts`。测试必须使用 `node:http.createServer` 和 adapter 默认 `fetch`，不能注入 fake adapter：

```ts
async function runTwoRound(protocol: 'openai-compatible' | 'anthropic-compatible') {
  const bodies: unknown[] = [];
  let round = 0;
  const server = createServer(async (req, res) => {
    bodies.push(JSON.parse(await readBody(req)));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    round++;
    if (protocol === 'openai-compatible' && round === 1) {
      res.end([
        'data: {"choices":[{"delta":{"content":"Checking."}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-http","function":{"name":"echo","arguments":"{\\"value\\":7}"}}]}}]}',
        'data: [DONE]',
        '',
      ].join('\n\n'));
    } else if (protocol === 'anthropic-compatible' && round === 1) {
      res.end([
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_http","name":"echo","input":{}}}',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"value\\":7}"}}',
        'event: content_block_stop',
        'data: {"type":"content_block_stop","index":0}',
        'event: message_stop',
        'data: {"type":"message_stop"}',
        '',
      ].join('\n\n'));
    } else if (protocol === 'openai-compatible') {
      res.end('data: {"choices":[{"delta":{"content":"done"}}]}\n\ndata: [DONE]\n\n');
    } else {
      res.end('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"done"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n');
    }
  });
  const baseUrl = await listen(server);
  try {
    const registry = new ToolRegistry();
    registry.register({ name: 'echo', description: '', parameters: { type: 'object' } },
      async args => ({ ok: true, output: String(args.value) }));
    const router = new ModelRouter();
    const engine = new AgentEngine({
      modelRouter: {
        chat: (req, opts) => router.chat(req, {
          apiKeyResolver: async () => opts.apiKey,
          onChunk: opts.onChunk,
          policy: { timeoutMs: 2_000, maxRetries: 0, circuitBreaker: false },
        }),
      },
      toolRegistry: registry,
    });
    await engine.run(makeHttpRunInput(protocol, baseUrl));
    return bodies;
  } finally {
    await close(server);
  }
}

it.each(['openai-compatible', 'anthropic-compatible'] as const)(
  '%s performs a protocol-correct two-round HTTP tool loop',
  async protocol => {
    const bodies = await runTwoRound(protocol);
    expect(bodies).toHaveLength(2);
    if (protocol === 'openai-compatible') {
      expect(bodies[1]).toMatchObject({ messages: [
        expect.anything(),
        { role: 'assistant', tool_calls: [{ id: 'call-http' }] },
        { role: 'tool', tool_call_id: 'call-http', content: '7' },
      ] });
    } else {
      expect(bodies[1]).toMatchObject({ messages: [
        expect.anything(),
        { role: 'assistant', content: [expect.objectContaining({ type: 'tool_use', id: 'toolu_http' })] },
        { role: 'user', content: [expect.objectContaining({ type: 'tool_result', tool_use_id: 'toolu_http', content: '7' })] },
      ] });
    }
  },
);
```

同文件实现 `readBody`、`listen`、`close` 和 `makeHttpRunInput`；监听 `127.0.0.1` 随机端口，`afterEach` 不留 server handle。

- [ ] **Step 5: 运行 engine 和真实 HTTP 测试**

Run: `cd packages/core && pnpm vitest run src/agent/AgentEngine.spec.ts src/model/tool-loop.integration.spec.ts`

Expected: 两种 protocol 都发生恰好 2 次 HTTP request 并 PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/agent/AgentEngine.ts packages/core/src/agent/AgentEngine.spec.ts packages/core/src/model/tool-loop.integration.spec.ts
git diff --cached --check
git commit -m "fix: preserve structured turns through the agent tool loop"
```

---

### Task 5: ModelRouter Main-path Wiring and Fallback Configuration

**Files:**
- Modify: `packages/core/src/model/router.ts`
- Modify: `packages/core/src/model/router.spec.ts`
- Modify: `packages/core/src/agent/AgentEngine.ts`
- Modify: `packages/core/src/agent/AgentEngine.spec.ts`
- Modify: `packages/core/src/task/TaskOrchestrator.ts`
- Modify: `apps/desktop/src/main/ipc/task-engine-factory.ts`
- Modify: `apps/desktop/src/main/ipc/tasks.ts`
- Modify: `apps/desktop/src/main/ipc/tasks.spec.ts`
- Modify: `apps/desktop/src/main/ipc/chat.ts`
- Modify: `apps/desktop/src/main/ipc/chat.spec.ts`
- Modify: `apps/desktop/src/main/ipc/office.ts`
- Modify: `apps/desktop/src/main/ipc/office.spec.ts`
- Create: `apps/desktop/src/main/ipc/model-route.ts`
- Create: `apps/desktop/src/main/ipc/model-route.spec.ts`
- Modify: `apps/desktop/src/main/db/migrations.ts`
- Modify: `apps/desktop/src/main/db/migrations.spec.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `apps/desktop/src/main/ipc/agents.ts`
- Modify: `apps/desktop/src/main/ipc/agents.spec.ts`
- Modify: `apps/desktop/src/renderer/src/pages/AgentDetailPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/AgentListView.spec.tsx`
- Modify: `packages/i18n/locales/zh-CN/common.json`
- Modify: `packages/i18n/locales/en/common.json`

**Interfaces:**
- Produces: `ModelTarget { provider: Provider; modelId: string }`。
- `RouterChatOpts.fallbackTargets?: readonly ModelTarget[]`、`signal?: AbortSignal`。
- `AgentConfig.fallbackModelIds?: string[]` 存储 `models.id`，不是供应商 model string；旧调用方缺省时在 main boundary 规范化为 `[]`。
- Produces main helper: `resolveModelRoute(db, primaryModelRowId, fallbackModelRowIds): { primary: ModelTarget; fallbacks: readonly ModelTarget[] }`。

- [ ] **Step 1: 写 ModelRouter 失败测试**

```ts
it('retries retryable failure then falls back across providers in declared order', async () => {
  const attempts: string[] = [];
  const router = new ModelRouter({
    createAdapter: type => ({
      type,
      async chat(req, ctx) {
        attempts.push(`${type}:${req.modelId}`);
        if (req.modelId !== 'backup-model') throw new RetryableError('http 503');
        ctx.onChunk({ kind: 'delta', delta: 'ok' });
      },
    }),
    sleep: async () => {},
    random: () => 0,
  });
  const result = await router.chat(primaryRequest, {
    apiKeyResolver: async ref => `key-for-${ref}`,
    fallbackTargets: [{
      provider: anthropicProvider,
      modelId: 'backup-model',
    }],
    policy: { timeoutMs: 5_000, maxRetries: 1, circuitBreaker: false },
  });
  expect(result.text).toBe('ok');
  expect(attempts).toEqual([
    'openai-compatible:primary-model',
    'openai-compatible:primary-model',
    'anthropic-compatible:backup-model',
  ]);
});

it('aborts the active adapter when the caller signal aborts', async () => {
  const caller = new AbortController();
  let adapterSignal!: AbortSignal;
  const router = new ModelRouter({ createAdapter: () => ({
    type: 'openai-compatible',
    async chat(_req, ctx) {
      adapterSignal = ctx.signal!;
      await new Promise<void>((_, reject) =>
        ctx.signal!.addEventListener('abort', () => reject(ctx.signal!.reason), { once: true }));
    },
  }) });
  const pending = router.chat(primaryRequest, {
    apiKeyResolver: async () => 'key',
    signal: caller.signal,
  });
  caller.abort(new DOMException('cancelled', 'AbortError'));
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(adapterSignal.aborted).toBe(true);
});
```

- [ ] **Step 2: 运行失败测试**

Run: `cd packages/core && pnpm vitest run src/model/router.spec.ts`

Expected: FAIL；当前 fallback 不能换 provider，且忽略 caller signal。

- [ ] **Step 3: 实现 Router target、取消和 jitter**

```ts
export interface ModelTarget {
  provider: Provider;
  modelId: string;
}

export interface RouterDeps {
  createAdapter?: (type: ProviderType) => ProviderAdapter;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

export interface RouterChatOpts {
  apiKeyResolver: (ref: string) => Promise<string | null>;
  policy?: ProviderPolicy;
  onChunk?: (chunk: ChatChunk) => void;
  fallbackTargets?: readonly ModelTarget[];
  signal?: AbortSignal;
}
```

targets 为 `[{ provider:req.provider, modelId:req.modelId }, ...fallbackTargets]`。每个 target 独立解析其 `apiKeyRef` 和创建对应 adapter。重试间隔为 `min(2_000, 100 * 2 ** attempt) + floor(random() * 100)`；`sleep` 接收 caller signal。`runOnce` 用 timeout controller，并把 caller abort 转发到 controller；finally 清 timer 和 abort listener。必须分别记录 `timedOut` 与 caller signal：内部 timer 触发映射为 `TimeoutError`，caller abort 原样抛出其 `AbortError`/reason 并立即退出全部 retry/fallback。

- [ ] **Step 4: 追加 v13 与 model-route**

迁移：

```ts
{
  version: 13,
  sql: `
    ALTER TABLE agents
      ADD COLUMN fallback_model_ids_json TEXT NOT NULL DEFAULT '[]';
  `,
}
```

`model-route.ts`：

```ts
export function resolveModelRoute(
  db: Database.Database,
  primaryModelRowId: string,
  fallbackModelRowIds: readonly string[],
): { primary: ModelTarget; fallbacks: readonly ModelTarget[] } {
  const ids = [primaryModelRowId, ...fallbackModelRowIds];
  const targets = ids.map(id => {
    const row = db.prepare(`
      SELECT m.model_id, p.id provider_id, p.name provider_name, p.type,
             p.base_url, p.api_key_ref, p.created_at, p.updated_at
      FROM models m JOIN providers p ON p.id = m.provider_id
      WHERE m.id = ?
    `).get(id) as ModelRouteRow | undefined;
    if (!row) throw new Error(`model route not found: ${id}`);
    return {
      provider: {
        id: row.provider_id,
        name: row.provider_name,
        type: row.type,
        baseUrl: row.base_url,
        apiKeyRef: row.api_key_ref,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
      modelId: row.model_id,
    };
  });
  return { primary: targets[0], fallbacks: Object.freeze(targets.slice(1)) };
}
```

`AgentConfig` 使用向后兼容的 `fallbackModelIds?: string[]`，agent row mapper/create/update 与 `AgentDetailPage` 一律按 `fallbackModelIds ?? []` 处理，并在 IPC response 中返回数组。UI 从 `model.list` 的用户模型中多选；新增 i18n keys：`agents.fallbackModels`，zh-CN=`备用模型`，en=`Fallback models`。

- [ ] **Step 5: 写迁移、route 与 UI/store 测试**

`model-route.spec.ts` 插入一个 OpenAI primary 和一个 Anthropic backup，断言 provider 顺序和实际用户 model string；传不存在 ID 时断言 `model route not found`。`agents.spec.ts` 断言 create/update/get round-trip 两个 fallback row IDs。`migrations.spec.ts` 断言 v12 DB 升级后默认 `[]`。`AgentListView.spec.tsx` 断言保存 payload 含用户选择的 model row IDs。

Run: `cd apps/desktop && pnpm vitest run src/main/ipc/model-route.spec.ts src/main/ipc/agents.spec.ts src/main/db/migrations.spec.ts src/renderer/src/pages/AgentListView.spec.tsx`

Expected: PASS。

- [ ] **Step 6: Task/Chat/Office 主路径统一接线**

`createDefaultChatFn` 不再创建 adapter，改为：

```ts
export function createDefaultChatFn(router = new ModelRouter()): EngineChatFn {
  return (req, opts) => router.chat(req, {
    apiKeyResolver: async () => opts.apiKey,
    fallbackTargets: opts.fallbackTargets,
    signal: opts.signal,
    onChunk: opts.onChunk,
  });
}
```

`EngineRunInput` / `SubmitInput` 增加 `fallbackTargets?: readonly ModelTarget[]`，Engine 转发给 `EngineChatFn`。Task、Chat、Office 都调用 `resolveModelRoute`；Office 的 async-generator bridge 内调用 `router.chat` 并通过 queue 转发 `onChunk`，删除生产代码中的直接 `createAdapter`。

在三个 main spec 中注入 fake `ModelRouter` 并断言：

```ts
expect(router.chat).toHaveBeenCalledWith(
  expect.objectContaining({ modelId: 'primary-model' }),
  expect.objectContaining({
    fallbackTargets: [
      expect.objectContaining({ modelId: 'backup-model' }),
    ],
  }),
);
```

`tasks.spec.ts` 另用真实 `ModelRouter` fake adapter 验证 Task 主路径经历 429 retry 后 fallback 并 completed；Office generator 提前 `return()` 后断言 router 收到的 signal 已 aborted。

- [ ] **Step 7: 运行本 Task 验证**

Run: `cd packages/core && pnpm vitest run src/model/router.spec.ts src/agent/AgentEngine.spec.ts src/task/TaskOrchestrator.spec.ts && cd ../../apps/desktop && pnpm vitest run src/main/ipc/model-route.spec.ts src/main/ipc/agents.spec.ts src/main/ipc/tasks.spec.ts src/main/ipc/chat.spec.ts src/main/ipc/office.spec.ts src/main/db/migrations.spec.ts src/renderer/src/pages/AgentListView.spec.tsx && cd ../.. && pnpm i18n:check && pnpm typecheck`

Expected: PASS；`rg "createAdapter\\(" apps/desktop/src/main/ipc/{task-engine-factory.ts,office.ts}` 无匹配。

- [ ] **Step 8: 提交**

```bash
git add packages/core/src/model/router.ts packages/core/src/model/router.spec.ts packages/core/src/agent/AgentEngine.ts packages/core/src/agent/AgentEngine.spec.ts packages/core/src/task/TaskOrchestrator.ts packages/protocol/src/index.ts apps/desktop/src/main/ipc/task-engine-factory.ts apps/desktop/src/main/ipc/tasks.ts apps/desktop/src/main/ipc/tasks.spec.ts apps/desktop/src/main/ipc/chat.ts apps/desktop/src/main/ipc/chat.spec.ts apps/desktop/src/main/ipc/office.ts apps/desktop/src/main/ipc/office.spec.ts apps/desktop/src/main/ipc/model-route.ts apps/desktop/src/main/ipc/model-route.spec.ts apps/desktop/src/main/ipc/agents.ts apps/desktop/src/main/ipc/agents.spec.ts apps/desktop/src/main/db/migrations.ts apps/desktop/src/main/db/migrations.spec.ts apps/desktop/src/renderer/src/pages/AgentDetailPage.tsx apps/desktop/src/renderer/src/pages/AgentListView.spec.tsx packages/i18n/locales/zh-CN/common.json packages/i18n/locales/en/common.json
git diff --cached --check
git commit -m "fix: route task chat and office through ModelRouter"
```

---

### Task 6: Run-scoped Immutable Tool Authorization

**Files:**
- Modify: `packages/core/src/agent/types.ts`
- Modify: `packages/core/src/agent/ToolRegistry.ts`
- Modify: `packages/core/src/agent/ToolRegistry.spec.ts`
- Modify: `packages/core/src/agent/AgentEngine.ts`
- Modify: `packages/core/src/agent/AgentEngine.spec.ts`
- Modify: `packages/core/src/task/TaskOrchestrator.ts`
- Modify: `packages/core/src/mcp/register.ts`
- Modify: `apps/desktop/src/main/ipc/mcp.ts`
- Modify: `apps/desktop/src/main/ipc/mcp.spec.ts`
- Modify: `apps/desktop/src/main/ipc/tasks.ts`
- Modify: `apps/desktop/src/main/ipc/tasks.spec.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  - `ToolAuthorization { agentId: string; allowedToolNames: readonly string[] }`
  - `AuthorizedToolView { list(): readonly ToolDef[]; execute(call, ctx): Promise<ToolResult> }`
  - `ToolRegistry.authorize(auth): AuthorizedToolView`
- `EngineRunInput.toolAuthorization` 必填；engine 构造后不再提供 `setVisibleTools/getVisibleTools`。

- [ ] **Step 1: 写 registry 失败测试**

```ts
it('creates an immutable run view that rejects another agent and later registrations', async () => {
  const registry = new ToolRegistry();
  registry.register(tool('read_file'), okHandler);
  const view = registry.authorize({
    agentId: 'agent-a',
    allowedToolNames: ['read_file'],
  });
  registry.register(tool('write_file'), okHandler);

  expect(view.list().map(t => t.name)).toEqual(['read_file']);
  await expect(view.execute(call('write_file'), context('agent-a')))
    .rejects.toThrow('tool not authorized: write_file');
  await expect(view.execute(call('read_file'), context('agent-b')))
    .rejects.toThrow('tool authorization agent mismatch');
});
```

- [ ] **Step 2: 运行失败测试**

Run: `cd packages/core && pnpm vitest run src/agent/ToolRegistry.spec.ts -t "immutable run view"`

Expected: FAIL；`authorize` 不存在。

- [ ] **Step 3: 实现授权视图**

```ts
export interface ToolAuthorization {
  agentId: string;
  allowedToolNames: readonly string[];
}

export interface AuthorizedToolView {
  list(): readonly ToolDef[];
  execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult>;
}

authorize(input: ToolAuthorization): AuthorizedToolView {
  const agentId = input.agentId;
  const names = new Set([...input.allowedToolNames]);
  const entries = new Map(
    [...this.tools].filter(([name]) => names.has(name)),
  );
  const defs = Object.freeze([...entries.values()].map(entry =>
    Object.freeze(structuredClone(entry.def))));
  return Object.freeze({
    list: () => defs,
    execute: async (call: ToolCall, ctx: ToolContext) => {
      if (ctx.agent?.id !== agentId) throw new Error('tool authorization agent mismatch');
      const entry = entries.get(call.name);
      if (!entry) throw new Error(`tool not authorized: ${call.name}`);
      return this.executeEntry(entry, call, ctx);
    },
  });
}
```

把现有 audit hook 放进私有 `executeEntry`，确保 view 与直接 execute 记录一致。

- [ ] **Step 4: Engine 捕获一次授权视图**

`EngineRunInput` 增加 `toolAuthorization: ToolAuthorization`。`run()` 第一行执行：

```ts
const tools = this.cfg.toolRegistry.authorize({
  agentId: input.toolAuthorization.agentId,
  allowedToolNames: Object.freeze([...input.toolAuthorization.allowedToolNames]),
});
```

每轮 request 使用 `tools.list()`，执行使用 `tools.execute()`；删除 `visibleTools` 字段和 setter/getter。

- [ ] **Step 5: MCP registration 返回绑定工具名**

`registerMcpTools` 返回 `Promise<readonly string[]>`。`registerAgentMcpTools` 即使 client 已缓存，也从 cache 保存的 `toolNames` 返回该 Agent 绑定 server 的名字：

```ts
const mcpClientCache = new Map<string, {
  client: McpClient;
  serverName: string;
  toolNames: readonly string[];
}>();

export async function registerAgentMcpTools(...): Promise<readonly string[]> {
  const allowed: string[] = [];
  // 只遍历 config.agentIds 包含 agentId 的 rows
  // 新注册或 cache hit 都把 entry.toolNames push 到 allowed
  return Object.freeze([...new Set(allowed)]);
}
```

Task 创建时：

```ts
const mcpToolNames = await registerAgentMcpTools(db, toolRegistry, agentId);
const baseToolNames = toolRegistry.list()
  .map(t => t.name)
  .filter(name => !name.startsWith('mcp:'));
const allowedToolNames = planVisibleTools(
  [...baseToolNames, ...mcpToolNames],
  agent.planOnly,
);
orchestrator.submit({
  ...run,
  toolAuthorization: Object.freeze({
    agentId,
    allowedToolNames: Object.freeze([...allowedToolNames]),
  }),
});
```

- [ ] **Step 6: 写并发隔离回归测试**

`AgentEngine.spec.ts` 用 barrier 同时启动两个 run：A 只允许 `read_file,mcp:fs:read`，B 只允许 `read_file,write_file,mcp:git:status`；在 A 第一轮等待时注册新工具并启动 B。断言每个 request 的 tools 和执行结果始终等于各自快照。

`mcp.spec.ts` 插入 fs→A、git→B 两个 server，断言 `registerAgentMcpTools(...A)` 不返回 git。`tasks.spec.ts` 同时 create Plan Agent 与普通 Agent，fake model 分别请求 `write_file`，断言 Plan run 得到 denied result、普通 run 执行成功，二者 request tools 不串扰。

- [ ] **Step 7: 运行隔离测试**

Run: `cd packages/core && pnpm vitest run src/agent/ToolRegistry.spec.ts src/agent/AgentEngine.spec.ts && cd ../../apps/desktop && pnpm vitest run src/main/ipc/mcp.spec.ts src/main/ipc/tasks.spec.ts && cd ../.. && pnpm typecheck`

Expected: PASS；`rg "setVisibleTools|getVisibleTools|visibleTools" packages/core apps/desktop/src/main` 无匹配。

- [ ] **Step 8: 提交**

```bash
git add packages/core/src/agent/types.ts packages/core/src/agent/ToolRegistry.ts packages/core/src/agent/ToolRegistry.spec.ts packages/core/src/agent/AgentEngine.ts packages/core/src/agent/AgentEngine.spec.ts packages/core/src/task/TaskOrchestrator.ts packages/core/src/mcp/register.ts packages/core/src/index.ts apps/desktop/src/main/ipc/mcp.ts apps/desktop/src/main/ipc/mcp.spec.ts apps/desktop/src/main/ipc/tasks.ts apps/desktop/src/main/ipc/tasks.spec.ts
git diff --cached --check
git commit -m "fix: enforce immutable per-run tool authorization"
```

---

### Task 7: MCP Timeout, Abort, Frame and Child Cleanup

**Files:**
- Modify: `packages/core/src/mcp/transport.ts`
- Modify: `packages/core/src/mcp/McpClient.ts`
- Modify: `packages/core/src/mcp/McpClient.spec.ts`
- Modify: `apps/desktop/src/main/ipc/mcp.ts`
- Modify: `apps/desktop/src/main/ipc/mcp.spec.ts`

**Interfaces:**
- Produces:
  - `McpTransport.onError(cb)`, `onClose(cb)`, idempotent `close()`。
  - `McpRequestOptions { timeoutMs?: number; signal?: AbortSignal }`
  - `initialize(options?)`, `listTools(options?)`, `callTool(name,args,options?)`
  - `McpTimeoutError`, `McpTransportError`, `McpFrameTooLargeError`
- `McpClient.debugPendingCount()` 只用于 spec，不从 package barrel 导出；生产完成条件为每种终止路径返回 0。

- [ ] **Step 1: 写失败测试矩阵**

在 `McpClient.spec.ts` 添加 fake-timer 测试：

```ts
it('times out one request and removes it from pending', async () => {
  vi.useFakeTimers();
  const { client } = makeSilentClient();
  const pending = client.listTools({ timeoutMs: 25 });
  await vi.advanceTimersByTimeAsync(25);
  await expect(pending).rejects.toBeInstanceOf(McpTimeoutError);
  expect(client.debugPendingCount()).toBe(0);
  vi.useRealTimers();
});

it('aborts one request without affecting a later request', async () => {
  const { client, process } = makeControlledClient();
  const controller = new AbortController();
  const first = client.listTools({ signal: controller.signal });
  controller.abort(new DOMException('cancelled', 'AbortError'));
  await expect(first).rejects.toMatchObject({ name: 'AbortError' });
  const second = client.listTools();
  process.respondToLast({ tools: [] });
  await expect(second).resolves.toEqual([]);
  expect(client.debugPendingCount()).toBe(0);
});

it.each(['error', 'exit'] as const)('rejects every pending request on child %s', async event => {
  const { client, process } = makeControlledClient();
  const a = client.initialize();
  const b = client.listTools();
  process.emit(event, event === 'exit' ? 9 : new Error('spawn failed'));
  await expect(a).rejects.toBeInstanceOf(McpTransportError);
  await expect(b).rejects.toBeInstanceOf(McpTransportError);
  expect(client.debugPendingCount()).toBe(0);
});

it('rejects pending and kills the child when one frame exceeds 1 MiB', async () => {
  const { client, process } = makeControlledClient({ maxFrameBytes: 16 });
  const pending = client.listTools();
  process.stdout.write('{"jsonrpc":"2.0","id":1,"result":"' + 'x'.repeat(32));
  await expect(pending).rejects.toBeInstanceOf(McpFrameTooLargeError);
  expect(process.killed).toBe(true);
  expect(client.debugPendingCount()).toBe(0);
});

it('active close rejects all pending and is idempotent', async () => {
  const { client } = makeSilentClient();
  const pending = client.initialize();
  client.close();
  client.close();
  await expect(pending).rejects.toThrow('closed');
  expect(client.debugPendingCount()).toBe(0);
});
```

- [ ] **Step 2: 运行失败测试**

Run: `cd packages/core && pnpm vitest run src/mcp/McpClient.spec.ts`

Expected: FAIL；当前 request 永久 pending，transport 无 child 事件和 frame 上限。

- [ ] **Step 3: 实现 byte-buffer transport**

不要使用 `readline`。直接监听 stdout data：

```ts
export interface McpTransport {
  send(message: Record<string, unknown>, signal?: AbortSignal): Promise<void>;
  onMessage(callback: (message: Record<string, unknown>) => void): () => void;
  onError(callback: (error: Error) => void): () => void;
  onClose(callback: (error: Error) => void): () => void;
  close(): void;
}

export interface StdioTransportOptions {
  maxFrameBytes?: number;
}

const DEFAULT_MAX_FRAME_BYTES = 1_048_576;
let buffer = Buffer.alloc(0);
child.stdout!.on('data', (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  if (buffer.byteLength > maxFrameBytes && buffer.indexOf(0x0a) < 0) {
    fail(new McpFrameTooLargeError(maxFrameBytes));
    close();
    return;
  }
  for (;;) {
    const newline = buffer.indexOf(0x0a);
    if (newline < 0) break;
    const frame = buffer.subarray(0, newline);
    buffer = buffer.subarray(newline + 1);
    if (frame.byteLength > maxFrameBytes) {
      fail(new McpFrameTooLargeError(maxFrameBytes));
      close();
      return;
    }
    try {
      emitMessage(JSON.parse(frame.toString('utf8')));
    } catch {
      fail(new McpTransportError('invalid MCP JSON frame'));
      close();
      return;
    }
  }
});
child.once('error', error => {
  fail(new McpTransportError(`MCP child error: ${error.message}`));
  close();
});
child.once('exit', (code, signal) => {
  fail(new McpTransportError(`MCP child exited code=${code ?? 'null'} signal=${signal ?? 'null'}`));
  close();
});
```

`fail` 和 `close` 均幂等；close 移除 stdout/child listeners、end stdin、kill 尚未退出的 child，并触发一次 close callback。

- [ ] **Step 4: 实现 pending 统一 finalize**

```ts
interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort?: () => void;
}

private finish(id: number, outcome: { value: unknown } | { error: Error }): void {
  const pending = this.pending.get(id);
  if (!pending) return;
  this.pending.delete(id);
  clearTimeout(pending.timer);
  if (pending.signal && pending.onAbort) {
    pending.signal.removeEventListener('abort', pending.onAbort);
  }
  if ('error' in outcome) pending.reject(outcome.error);
  else pending.resolve(outcome.value);
}

private failAll(error: Error): void {
  for (const id of [...this.pending.keys()]) this.finish(id, { error });
}
```

`request(method,params,options={})` 在 send 前检查 pre-aborted signal，先注册 pending/timer/abort listener，再 `await transport.send(message, options.signal)`；send reject 时立即经 `finish(id,{error})` 清理并抛出。timeout 使用 `options.timeoutMs ?? 30_000`；transport error/close 调 `failAll`。response、timeout、abort、send reject、exit、error、oversize、close 全部只能经 `finish/failAll` 完成。stdio 的 `send` 声明为 async 并在 write callback error 时 reject，为后续 SSE/Streamable HTTP transport 保持同一契约。

- [ ] **Step 5: main MCP 调用显式传 deadline/signal**

`testMcpServer` 创建一个 controller，并给 initialize/list 各传 `{ timeoutMs: 10_000, signal }`；finally `controller.abort()` 后 close。注册阶段 initialize/list 使用 `30_000ms`。MCP tool handler 将 `ToolContext.signal` 传给 `client.callTool(..., { timeoutMs: 30_000, signal: ctx.signal })`。

`mcp.spec.ts` 添加无响应 test 在 10 秒 fake timer 后返回 `{ok:false,error:...timeout...}`，并断言 fake child killed；初始化期间 child exit 后 cache 不保留 entry，第二次注册只新 spawn 一次。

- [ ] **Step 6: 运行 MCP 与 main 接线测试**

Run: `cd packages/core && pnpm vitest run src/mcp/McpClient.spec.ts && cd ../../apps/desktop && pnpm vitest run src/main/ipc/mcp.spec.ts && cd ../.. && pnpm typecheck`

Expected: PASS；Vitest 无 open handle 警告。

- [ ] **Step 7: 提交**

```bash
git add packages/core/src/mcp/transport.ts packages/core/src/mcp/McpClient.ts packages/core/src/mcp/McpClient.spec.ts apps/desktop/src/main/ipc/mcp.ts apps/desktop/src/main/ipc/mcp.spec.ts
git diff --cached --check
git commit -m "fix: bound MCP requests and clean pending lifecycle"
```

---

## Final Verification

- [ ] 运行 Plan 2 core 定向测试：

Run: `cd packages/core && pnpm vitest run src/model src/agent src/mcp`

Expected: PASS。

- [ ] 运行 Electron main 定向测试：

Run: `cd apps/desktop && pnpm vitest run src/main/ipc/model-route.spec.ts src/main/ipc/agents.spec.ts src/main/ipc/tasks.spec.ts src/main/ipc/chat.spec.ts src/main/ipc/office.spec.ts src/main/ipc/mcp.spec.ts src/main/db/migrations.spec.ts`

Expected: PASS。

- [ ] 运行全仓静态与单元门禁：

Run: `pnpm typecheck && pnpm test && pnpm i18n:check && pnpm build`

Expected: 全部 exit 0。

- [ ] 检查 CR 关键反模式已消失：

Run: `rg "setVisibleTools|getVisibleTools|visibleTools" packages/core apps/desktop/src/main`

Expected: 无匹配。

Run: `rg "createAdapter\\(" apps/desktop/src/main/ipc/task-engine-factory.ts apps/desktop/src/main/ipc/office.ts`

Expected: 无匹配。

- [ ] 检查工作树只包含计划内实现文件后，由执行者按 Task 提交；不要把其它既有工作树改动带入提交。
