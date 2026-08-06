# M2 Agent 基础 (Agent Basic) 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本计划依赖 M0/M1 已建成:pnpm Monorepo、`packages/core`(ModelRouter/ProviderAdapter/ChatService)、`apps/desktop` main IPC 框架、SQLite schema v1(agents/tasks 表)、渲染层路由与 store 模式。

**Goal:** 实现自定义 Agent 管理(F1–F6)、AgentEngine v1(REACT loop,决策一 A)、Task 状态机与队列(queued→running→completed/failed/cancelled/paused)、取消/暂停/重试(L4)、流式双通道(L5)、JARVIS.md 上下文注入(L10)、Agent 切换器(K2)、工作区绑定(C7)与环境变量注入(C8)。

**Architecture:** AgentEngine/REACT Loop 唯一实现在 `packages/core`(TS)。本地 Task 由 Electron main 内的 TS `TaskOrchestrator` 调度并执行,Task 写入 `tasks` 表。**里程碑说明(与 §13.3 每表单写者的衔接):** M2–M6 期间 `tasks` 表的写者为 Electron main(本地模式唯一调度者);M7 引入 jarvis-daemon 作为 Multica Client 与调度入口时,Multica 任务的 `tasks` 写入迁移至 Go daemon,并确保两模式不同时并发写同一行。本里程碑不实现 MCP/文件/Shell 工具(属 M3核心);REACT loop 以 `echo` 测试工具验证循环机制。

**Tech Stack:** M0/M1 技术栈 + 无新重依赖。Task 状态机用纯 TS 实现;并发用 `p-limit` 或自研 semaphore。

## Global Constraints

(继承 M0/M1 全部约束。M2 相关复述:)

- **决策一 A:** REACT Loop 唯一实现于 packages/core;Go 侧不重写。
- **F14 并发:** 默认并发 6/Agent、20/机器(M3 起生效于 daemon;M2 用内存 semaphore)。
- **L4 Task 控制:** 取消用 AbortController + SIGTERM shell 子进程(子进程 M3);暂停为状态置 paused、恢复回 running。
- **L5 双通道:** `chat:delta` + `task:log` 两个事件通道。
- **L10:** 首次绑定工作区生成 JARVIS.md / AGENTS.md 模板。
- **Q4:** Agent.model_id 引用用户自定义 model(FK models.id),禁止硬编码。
- **i18n:** 新增 UI 文案需 zh-CN/en 对称。
- **每表单写者(§13.3):** agents 表 main 属主;tasks 表 M2–M6 由 Electron main 写入(见 Architecture 说明)。

## 文件结构总览(本里程碑新增)

```
packages/core/src/
├── agent/
│   ├── types.ts                 # ToolDef/ToolCall/ToolResult/TaskResult/ApprovalRequest
│   ├── ToolRegistry.ts          # 注册/列出/执行工具
│   ├── AgentEngine.ts           # REACT loop v1
│   └── AgentEngine.spec.ts
├── task/
│   ├── TaskStateMachine.ts      # 状态机纯逻辑
│   ├── TaskStateMachine.spec.ts
│   └── TaskOrchestrator.ts      # 队列+并发+取消/暂停/重试
└── index.ts                     # 重导出
apps/desktop/src/main/
├── ipc/agents.ts                # agent CRUD store + IPC
├── ipc/tasks.ts                 # task.create/cancel/pause/retry + 流式转发
├── ipc/workspace.ts             # C7 工作区绑定 + JARVIS.md 生成
└── ipc/IpcRouter.ts             # 扩展注册
apps/desktop/src/renderer/src/
├── stores/agent-store.ts
├── stores/task-store.ts
├── components/agents/AgentSwitcher.tsx      # K2
├── pages/AgentListView.tsx                  # C2
├── pages/AgentDetailPage.tsx                # F1-F6 编辑(基础字段)
└── pages/ChatPage.tsx                       # 改造:接入 Agent 绑定 + task 执行
```

---

### Task 1: Agent 类型细化 + ToolRegistry 基础设施

**Files:**
- Create: `packages/core/src/agent/types.ts`
- Create: `packages/core/src/agent/ToolRegistry.ts`
- Create: `packages/core/src/agent/ToolRegistry.spec.ts`

**Interfaces:**
- Consumes: M1 `ChatRequest`/`ModelMessage`。
- Produces:
  - `ToolDef { name; description; parameters: Record<string, unknown> }`
  - `ToolCall { id; name; arguments: Record<string, unknown> }`(复用 M1 的 ToolCall 类型)
  - `ToolContext { cwd: string; env: Record<string, string>; signal?: AbortSignal }`
  - `ToolResult { ok: boolean; output: string }`
  - `TaskResult { text: string; toolCalls: number; usage: Usage | null }`
  - `ApprovalRequest { toolName: string; args: Record<string, unknown>; prompt: string }`
  - `ToolRegistry` 类:`register(def, handler)`、`list(): ToolDef[]`、`has(name)`、`execute(name, args, ctx): Promise<ToolResult>`。

- [ ] **Step 1: 编写失败测试**

`packages/core/src/agent/ToolRegistry.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ToolRegistry } from './ToolRegistry';

describe('ToolRegistry', () => {
  it('registers and lists tools', () => {
    const reg = new ToolRegistry();
    reg.register({ name: 'echo', description: 'echo input', parameters: { type: 'object', properties: { text: { type: 'string' } } } }, async () => ({ ok: true, output: '' }));
    expect(reg.list().map(t => t.name)).toContain('echo');
  });

  it('executes tool handler with args and context', async () => {
    const reg = new ToolRegistry();
    reg.register({ name: 'echo', description: '', parameters: {} }, async (args, ctx) => ({ ok: true, output: `${ctx.cwd}:${args.text}` }));
    const r = await reg.execute('echo', { text: 'hi' }, { cwd: '/tmp', env: {} });
    expect(r.output).toBe('/tmp:hi');
  });

  it('throws on unknown tool', async () => {
    const reg = new ToolRegistry();
    await expect(reg.execute('nope', {}, { cwd: '/', env: {} })).rejects.toThrow('unknown tool');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/core && pnpm vitest run src/agent/ToolRegistry.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 编写实现**

`packages/core/src/agent/types.ts`:
```ts
import type { ToolCall, Usage } from '../model/types';

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolContext {
  cwd: string;
  env: Record<string, string>;
  signal?: AbortSignal;
}

export interface ToolResult {
  ok: boolean;
  output: string;
}

export interface TaskResult {
  text: string;
  toolCalls: number;
  usage: Usage | null;
}

export interface ApprovalRequest {
  toolName: string;
  args: Record<string, unknown>;
  prompt: string;
}

export type { ToolCall };
```

`packages/core/src/agent/ToolRegistry.ts`:
```ts
import type { ToolDef, ToolContext, ToolResult, ToolCall } from './types';

type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;

export class ToolRegistry {
  private tools = new Map<string, { def: ToolDef; handler: ToolHandler }>();

  register(def: ToolDef, handler: ToolHandler): void {
    this.tools.set(def.name, { def, handler });
  }

  list(): ToolDef[] { return [...this.tools.values()].map(t => t.def); }
  has(name: string): boolean { return this.tools.has(name); }

  async execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) throw new Error(`unknown tool: ${call.name}`);
    return tool.handler(call.arguments, ctx);
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/core && pnpm vitest run src/agent/ToolRegistry.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent
git commit -m "feat(core): tool registry infrastructure (F13 basis)"
```

---

### Task 2: AgentEngine v1 REACT loop

**Files:**
- Create: `packages/core/src/agent/AgentEngine.ts`
- Create: `packages/core/src/agent/AgentEngine.spec.ts`
- Modify: `packages/core/src/index.ts`(重导出)

**Interfaces:**
- Consumes: Task 1 ToolRegistry;M1 ModelRouter 风格 `chat`。
- Produces:
  - `EngineChatFn = (req: ChatRequest, opts: { apiKey: string; signal?: AbortSignal; onChunk?: (c: ChatChunk) => void }) => Promise<{ text: string; usage: Usage | null }>`
  - `AgentEngineConfig { modelRouter: { chat: EngineChatFn }; toolRegistry: ToolRegistry; approvalGate?: (req: ApprovalRequest) => Promise<boolean>; maxSteps?: number; maxTokens?: number }`
  - `EngineRunInput { agent: AgentConfig; messages: ModelMessage[]; cwd: string; env: Record<string,string>; apiKey: string; signal?: AbortSignal; onDelta?: (d: string) => void; onTool?: (call: ToolCall, result: ToolResult) => void }`
  - `AgentEngine.run(input): Promise<TaskResult>` — REACT loop:调用 chat → 解析 `tool_call` chunk 里的 toolCalls → approvalGate 审批 → execute → append tool 结果到 context → 重复直到 maxSteps 或文本结束。
  - 解析机制:依赖模型返回 `tool_call` chunk(M1 适配器已支持 OpenAI tool_calls / Anthropic tool_use)。M2 测试用假 chat 函数返回 tool_call chunk 再返回文本。

- [ ] **Step 1: 编写失败测试**

`packages/core/src/agent/AgentEngine.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { AgentEngine } from './AgentEngine';
import { ToolRegistry } from './ToolRegistry';
import type { ChatChunk } from '../model/types';
import type { AgentConfig } from '@jarvis/protocol';

function fakeChat(script: Array<() => void>) {
  return async (_req: unknown, opts: { signal?: AbortSignal; onChunk?: (c: ChatChunk) => void }) => {
    for (const s of script) s();
    opts.onChunk?.({ kind: 'tool_call', toolCalls: [{ id: 't1', name: 'echo', arguments: { text: 'a' } }] });
    opts.onChunk?.({ kind: 'done' });
    return { text: '', usage: null };
  };
}

const agent: AgentConfig = { id: 'a1', name: 'A', slug: 'a', description: '', systemPrompt: 'be terse', modelId: 'm1', workspaceId: null, contextBudgetTokens: 1000, planOnly: false, createdAt: '', updatedAt: '' };

describe('AgentEngine', () => {
  it('executes tool calls then completes', async () => {
    const reg = new ToolRegistry();
    const seen: string[] = [];
    reg.register({ name: 'echo', description: '', parameters: {} }, async (args) => { seen.push(String(args.text)); return { ok: true, output: String(args.text) }; });
    const engine = new AgentEngine({ modelRouter: { chat: fakeChat([]) }, toolRegistry: reg, maxSteps: 3 });
    const result = await engine.run({ agent, messages: [{ role: 'user', content: 'go' }], cwd: '/tmp', env: {}, apiKey: 'sk' });
    expect(seen).toEqual(['a']);
    expect(result.toolCalls).toBe(1);
  });

  it('stops at maxSteps', async () => {
    const reg = new ToolRegistry();
    reg.register({ name: 'echo', description: '', parameters: {} }, async () => ({ ok: true, output: 'x' }));
    let calls = 0;
    const engine = new AgentEngine({ modelRouter: { chat: fakeChat(() => { calls++; }) }, toolRegistry: reg, maxSteps: 2 });
    const result = await engine.run({ agent, messages: [{ role: 'user', content: 'go' }], cwd: '/', env: {}, apiKey: 'sk' });
    expect(calls).toBeLessThanOrEqual(2);
    expect(result.toolCalls).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/core && pnpm vitest run src/agent/AgentEngine.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 编写实现**

`packages/core/src/agent/AgentEngine.ts`:
```ts
import type { AgentConfig } from '@jarvis/protocol';
import type { ChatChunk, ChatRequest, Usage } from '../model/types';
import type { ToolRegistry } from './ToolRegistry';
import type { ApprovalRequest, TaskResult, ToolCall, ToolResult } from './types';

export interface EngineChatFn {
  (req: ChatRequest, opts: { apiKey: string; signal?: AbortSignal; onChunk?: (c: ChatChunk) => void }): Promise<{ text: string; usage: Usage | null }>;
}

export interface AgentEngineConfig {
  modelRouter: { chat: EngineChatFn };
  toolRegistry: ToolRegistry;
  approvalGate?: (req: ApprovalRequest) => Promise<boolean>;
  maxSteps?: number;
  maxTokens?: number;
}

export interface EngineRunInput {
  agent: AgentConfig;
  messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>;
  cwd: string;
  env: Record<string, string>;
  apiKey: string;
  signal?: AbortSignal;
  onDelta?: (d: string) => void;
  onTool?: (call: ToolCall, result: ToolResult) => void;
  provider: { type: 'openai-compatible' | 'anthropic-compatible'; baseUrl: string };
  modelId: string;
}

export class AgentEngine {
  private maxSteps: number;
  constructor(private cfg: AgentEngineConfig) { this.maxSteps = cfg.maxSteps ?? 10; }

  async run(input: EngineRunInput): Promise<TaskResult> {
    const { agent, messages, cwd, env, apiKey, signal, onDelta, onTool } = input;
    let working: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }> = [...messages];
    let toolCalls = 0;
    let totalUsage: Usage | null = null;
    let finalText = '';

    for (let step = 0; step < this.maxSteps; step++) {
      const req: ChatRequest = {
        provider: { id: agent.id, name: agent.name, type: input.provider.type, baseUrl: input.provider.baseUrl, apiKeyRef: '', createdAt: '', updatedAt: '' },
        modelId: input.modelId,
        messages: working,
        stream: true,
        maxTokens: this.cfg.maxTokens
      };

      let callCalls: ToolCall[] = [];
      const { text, usage } = await this.cfg.modelRouter.chat(req, {
        apiKey,
        signal,
        onChunk: (c) => {
          if (c.kind === 'delta') { onDelta?.(c.delta); }
          if (c.kind === 'tool_call') callCalls = callCalls.concat(c.toolCalls);
          if (c.kind === 'usage') totalUsage = c.usage;
        }
      });
      if (text) {
        finalText += text;
        working.push({ role: 'assistant', content: text });
      }
      if (usage) totalUsage = usage;

      if (callCalls.length === 0) break;

      for (const call of callCalls) {
        toolCalls++;
        if (this.cfg.approvalGate) {
          const ok = await this.cfg.approvalGate({ toolName: call.name, args: call.arguments, prompt: `run ${call.name}` });
          if (!ok) {
            working.push({ role: 'tool', content: `[denied] ${call.name}` });
            continue;
          }
        }
        const result = await this.cfg.toolRegistry.execute(call, { cwd, env, signal });
        onTool?.(call, result);
        working.push({ role: 'tool', content: result.output });
      }
    }

    return { text: finalText, toolCalls, usage: totalUsage };
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/core && pnpm vitest run src/agent/AgentEngine.spec.ts`
Expected: PASS。

- [ ] **Step 5: 更新 index.ts 重导出**

`packages/core/src/index.ts` 追加:
```ts
export * from './agent/types';
export * from './agent/ToolRegistry';
export * from './agent/AgentEngine';
export * from './task/TaskStateMachine';
export * from './task/TaskOrchestrator';
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/agent packages/core/src/index.ts
git commit -m "feat(core): REACT-loop AgentEngine v1 with approval gate and tool execution"
```

---

### Task 3: Task 状态机 + TaskOrchestrator(队列/并发/取消/暂停/重试)(F14/L4)

**Files:**
- Create: `packages/core/src/task/TaskStateMachine.ts`
- Create: `packages/core/src/task/TaskStateMachine.spec.ts`
- Create: `packages/core/src/task/TaskOrchestrator.ts`
- Create: `packages/core/src/task/TaskOrchestrator.spec.ts`

**Interfaces:**
- Consumes: Task 2 AgentEngine。
- Produces:
  - `TaskState = 'queued'|'running'|'completed'|'failed'|'cancelled'|'paused'`
  - `transition(from, event): TaskState` — 事件 `start|complete|fail|cancel|pause|resume|retry`;非法转移抛错。
  - `TaskOrchestrator` 类:
    - 构造 `{ engine: AgentEngine; store: TaskStoreAdapter; concurrency?: number; signal? }`
    - `TaskStoreAdapter { create(task): Promise<void>; updateState(id, state): Promise<void>; appendLog(id, line): Promise<void>; }`
    - `submit(input: { id; agent; messages; cwd; env; apiKey; provider; modelId }): void` — 入队
    - `cancel(id)/pause(id)/resume(id)/retry(id)` — 操作进行中 Task 用 AbortController
    - 内部 per-agent semaphore(默认 6),并发受控;状态变更回调 `onStateChange(id, state)`
  - 事件:`task:state`、`task:log` 由 main 层桥接。

- [ ] **Step 1: 编写失败测试(状态机)**

`packages/core/src/task/TaskStateMachine.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { transition } from './TaskStateMachine';

describe('TaskStateMachine', () => {
  it('follows happy path', () => {
    expect(transition('queued', 'start')).toBe('running');
    expect(transition('running', 'complete')).toBe('completed');
  });
  it('allows retry from failed', () => {
    expect(transition('failed', 'retry')).toBe('queued');
  });
  it('rejects illegal transition', () => {
    expect(() => transition('completed', 'start')).toThrow('invalid transition');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/core && pnpm vitest run src/task/TaskStateMachine.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 编写状态机**

`packages/core/src/task/TaskStateMachine.ts`:
```ts
export type TaskState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
export type TaskEvent = 'start' | 'complete' | 'fail' | 'cancel' | 'pause' | 'resume' | 'retry';

const TABLE: Record<TaskState, Partial<Record<TaskEvent, TaskState>>> = {
  queued: { start: 'running', cancel: 'cancelled' },
  running: { complete: 'completed', fail: 'failed', cancel: 'cancelled', pause: 'paused' },
  completed: { retry: 'queued' },
  failed: { retry: 'queued', cancel: 'cancelled' },
  cancelled: { retry: 'queued' },
  paused: { resume: 'running', cancel: 'cancelled' }
};

export function transition(from: TaskState, event: TaskEvent): TaskState {
  const next = TABLE[from][event];
  if (!next) throw new Error(`invalid transition ${from} + ${event}`);
  return next;
}
```

- [ ] **Step 4: 运行状态机测试确认通过**

Run: `cd packages/core && pnpm vitest run src/task/TaskStateMachine.spec.ts`
Expected: PASS。

- [ ] **Step 5: 编写 TaskOrchestrator**

`packages/core/src/task/TaskOrchestrator.ts`:
```ts
import type { AgentConfig } from '@jarvis/protocol';
import type { AgentEngine, EngineRunInput } from '../agent/AgentEngine';
import { transition, type TaskState } from './TaskStateMachine';

export interface TaskStoreAdapter {
  create(id: string, agentId: string): Promise<void>;
  updateState(id: string, state: TaskState): Promise<void>;
  appendLog(id: string, line: string): Promise<void>;
}

export interface SubmitInput {
  id: string;
  agent: AgentConfig;
  messages: EngineRunInput['messages'];
  cwd: string;
  env: Record<string, string>;
  apiKey: string;
  provider: EngineRunInput['provider'];
  modelId: string;
}

export interface TaskOrchestratorCallbacks {
  onStateChange?: (id: string, state: TaskState) => void;
  onLog?: (id: string, line: string) => void;
  onDone?: (id: string, ok: boolean, text: string) => void;
}

const DEFAULT_CONCURRENCY_PER_AGENT = 6;

export class TaskOrchestrator {
  private queue: Array<{ input: SubmitInput; controller: AbortController }> = [];
  private active = new Map<string, number>();   // agentId -> running count
  private states = new Map<string, TaskState>();
  private controllers = new Map<string, AbortController>();

  constructor(
    private engine: AgentEngine,
    private store: TaskStoreAdapter,
    private cb: TaskCallbacks = {},
    private perAgent: number = DEFAULT_CONCURRENCY_PER_AGENT
  ) {}

  submit(input: SubmitInput): void {
    this.states.set(input.id, 'queued');
    this.queue.push({ input, controller: new AbortController() });
    this.controllers.set(input.id, this.queue[this.queue.length - 1].controller);
    this.cb.onStateChange?.(input.id, 'queued');
    void this.pump();
  }

  async cancel(id: string): Promise<void> {
    const controller = this.controllers.get(id);
    if (!controller) return;
    controller.abort();
    const st = this.states.get(id);
    if (st === 'running') await this.store.updateState(id, transition(st, 'cancel'));
    this.states.set(id, 'cancelled');
    this.cb.onStateChange?.(id, 'cancelled');
  }

  pause(id: string): void {
    const st = this.states.get(id);
    if (st === 'running') { this.states.set(id, 'paused'); this.cb.onStateChange?.(id, 'paused'); }
  }

  resume(id: string): void {
    if (this.states.get(id) === 'paused') { this.states.set(id, 'running'); this.cb.onStateChange?.(id, 'running'); }
  }

  async retry(id: string): Promise<void> {
    const st = this.states.get(id);
    if (st !== 'failed' && st !== 'cancelled' && st !== 'completed') return;
    const item = this.queue.find(q => q.input.id === id);
    if (!item) return;
    item.controller = new AbortController();
    this.controllers.set(id, item.controller);
    this.states.set(id, 'queued');
    this.cb.onStateChange?.(id, 'queued');
    await this.pump();
  }

  private async pump(): Promise<void> {
    let progressed = true;
    while (progressed) {
      progressed = false;
      const idx = this.queue.findIndex((item, i) => {
        const st = this.states.get(item.input.id);
        const running = this.active.get(item.input.agent.id) ?? 0;
        return st === 'queued' && (st === 'queued') && running < this.perAgent;
      });
      if (idx < 0) break;
      progressed = true;
      const item = this.queue.splice(idx, 1)[0];
      void this.runOne(item);
    }
  }

  private async runOne(item: { input: SubmitInput; controller: AbortController }): Promise<void> {
    const { input, controller } = item;
    const agentRunning = (this.active.get(input.agent.id) ?? 0) + 1;
    this.active.set(input.agent.id, agentRunning);
    await this.store.updateState(input.id, transition('queued', 'start'));
    this.states.set(input.id, 'running');
    this.cb.onStateChange?.(input.id, 'running');

    try {
      const result = await this.engine.run({ ...input, signal: controller.signal, onDelta: (d) => { this.cb.onLog?.(input.id, d); void this.store.appendLog(input.id, d); } });
      await this.store.updateState(input.id, transition('running', 'complete'));
      this.states.set(input.id, 'completed');
      this.cb.onStateChange?.(input.id, 'completed');
      this.cb.onDone?.(input.id, true, result.text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.store.updateState(input.id, transition('running', 'fail'));
      this.states.set(input.id, 'failed');
      this.cb.onStateChange?.(input.id, 'failed');
      this.cb.onDone?.(input.id, false, msg);
    } finally {
      this.active.set(input.agent.id, Math.max(0, (this.active.get(input.agent.id) ?? 0) - 1));
      void this.pump();
    }
  }
}
```

- [ ] **Step 6: 编写 TaskOrchestrator 失败测试**

`packages/core/src/task/TaskOrchestrator.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { TaskOrchestrator, type TaskStoreAdapter } from './TaskOrchestrator';
import { AgentEngine } from '../agent/AgentEngine';
import { ToolRegistry } from '../agent/ToolRegistry';
import type { AgentConfig } from '@jarvis/protocol';

const agent: AgentConfig = { id: 'a1', name: 'A', slug: 'a', description: '', systemPrompt: '', modelId: 'm1', workspaceId: null, contextBudgetTokens: 1000, planOnly: false, createdAt: '', updatedAt: '' };

function makeStore(): { store: TaskStoreAdapter; states: string[] } {
  const states: string[] = [];
  return {
    states,
    store: {
      async create(id) {},
      async updateState(id, state) { states.push(state); },
      async appendLog() {}
    }
  };
}

describe('TaskOrchestrator', () => {
  it('runs a task to completion', async () => {
    const reg = new ToolRegistry();
    const engine = new AgentEngine({ modelRouter: { chat: async (_r, o) => { o.onChunk?.({ kind: 'done' }); return { text: 'ok', usage: null }; } }, toolRegistry: reg });
    const { store, states } = makeStore();
    const orb = new TaskOrchestrator(engine, store, {}, 1);
    const done = new Promise<void>((res) => { orb = new TaskOrchestrator(engine, store, { onDone: () => res() }, 1); orb.submit({ id: 't1', agent, messages: [{ role: 'user', content: 'x' }], cwd: '/', env: {}, apiKey: 'sk', provider: { type: 'openai-compatible', baseUrl: 'https://x.com' }, modelId: 'm1' }); });
    await done;
    expect(states).toEqual(['running', 'completed']);
  });

  it('respects per-agent concurrency cap', async () => {
    let active = 0; let peak = 0;
    const reg = new ToolRegistry();
    const engine = new AgentEngine({ modelRouter: { chat: async (_r, o) => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 10)); active--; o.onChunk?.({ kind: 'done' }); return { text: '', usage: null }; } }, toolRegistry: reg });
    const { store } = makeStore();
    let finished = 0;
    const orb = new TaskOrchestrator(engine, store, { onDone: () => { finished++; } }, 2);
    for (let i = 0; i < 5; i++) orb.submit({ id: `t${i}`, agent, messages: [], cwd: '/', env: {}, apiKey: 'sk', provider: { type: 'openai-compatible', baseUrl: 'x' }, modelId: 'm1' });
    await new Promise(r => setTimeout(r, 100));
    expect(peak).toBeLessThanOrEqual(2);
    expect(finished).toBe(5);
  });
});
```

- [ ] **Step 7: 运行 TaskOrchestrator 测试确认通过**

Run: `cd packages/core && pnpm vitest run src/task`
Expected: PASS(状态机 + orchestrator 全绿)。

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/task packages/core/src/index.ts
git commit -m "feat(core): task state machine and concurrent orchestrator (F14/L4)"
```

---

### Task 4: Agent CRUD store + IPC(F1–F6 字段)

**Files:**
- Create: `apps/desktop/src/main/ipc/agents.ts`
- Create: `apps/desktop/src/main/ipc/agents.spec.ts`

**Interfaces:**
- Consumes: M0 schema v1(agents 表)、M1 providers/models。
- Produces: `createAgentStore(db)`:
  - `list(): AgentConfig[]`、`create(input): AgentConfig`、`update(id, patch)`、`remove(id)`、`get(id)`。
  - 字段:`name/slug/description/systemPrompt/modelId/workspaceId/contextBudgetTokens/planOnly/envVarsJson/cliArgsJson`。
  - IPC:agent.list/create/update/delete。slug 唯一;生成默认 slug(英文 kebab)。

- [ ] **Step 1: 编写失败测试**

`apps/desktop/src/main/ipc/agents.spec.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../db/migrations';
import { createAgentStore } from './agents';

describe('agent store', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  it('creates and lists agent with slug', async () => {
    const store = createAgentStore(db);
    const a = store.create({ name: 'Coding Agent', systemPrompt: 'You write code', modelId: null, workspaceId: null });
    expect(a.slug).toBe('coding-agent');
    expect(store.list().length).toBe(1);
  });

  it('updates agent fields', async () => {
    const store = createAgentStore(db);
    const a = store.create({ name: 'A', systemPrompt: '', modelId: null, workspaceId: null });
    const updated = store.update(a.id, { systemPrompt: 'new prompt' });
    expect(updated.systemPrompt).toBe('new prompt');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/desktop && pnpm vitest run src/main/ipc/agents.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 编写实现**

`apps/desktop/src/main/ipc/agents.ts`:
```ts
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { AgentConfig } from '@jarvis/protocol';

export interface AgentInput { name: string; systemPrompt: string; modelId: string | null; workspaceId: string | null; description?: string; contextBudgetTokens?: number; planOnly?: boolean; envVars?: Record<string, string>; cliArgs?: string[] }

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';
}

export function createAgentStore(db: Database.Database) {
  const now = () => new Date().toISOString();
  const rowToAgent = (r: Record<string, unknown>): AgentConfig => ({
    id: r.id as string, name: r.name as string, slug: r.slug as string, description: (r.description as string) ?? '',
    systemPrompt: (r.system_prompt as string) ?? '', modelId: (r.model_id as string) ?? null, workspaceId: (r.workspace_id as string) ?? null,
    contextBudgetTokens: (r.context_budget_tokens as number) ?? 128000, planOnly: Boolean(r.plan_only),
    createdAt: r.created_at as string, updatedAt: r.updated_at as string
  });

  return {
    list(): AgentConfig[] {
      return (db.prepare('SELECT * FROM agents ORDER BY created_at').all() as Record<string, unknown>[]).map(rowToAgent);
    },
    get(id: string): AgentConfig {
      const r = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      if (!r) throw new Error(`agent not found: ${id}`);
      return rowToAgent(r);
    },
    create(input: AgentInput): AgentConfig {
      const id = randomUUID();
      const slug = slugify(input.name);
      db.prepare('INSERT INTO agents (id, name, slug, description, system_prompt, model_id, workspace_id, context_budget_tokens, plan_only, env_vars_json, cli_args_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, input.name, slug, input.description ?? '', input.systemPrompt, input.modelId, input.workspaceId,
          input.contextBudgetTokens ?? 128000, input.planOnly ? 1 : 0, JSON.stringify(input.envVars ?? {}), JSON.stringify(input.cliArgs ?? []), now(), now());
      return this.get(id);
    },
    update(id: string, patch: Partial<AgentInput>): AgentConfig {
      const cur = this.get(id);
      db.prepare('UPDATE agents SET name=?, system_prompt=?, model_id=?, workspace_id=?, description=?, context_budget_tokens=?, plan_only=?, updated_at=? WHERE id=?')
        .run(patch.name ?? cur.name, patch.systemPrompt ?? cur.systemPrompt, patch.modelId !== undefined ? patch.modelId : cur.modelId,
          patch.workspaceId !== undefined ? patch.workspaceId : cur.workspaceId, patch.description ?? cur.description,
          patch.contextBudgetTokens ?? cur.contextBudgetTokens, patch.planOnly !== undefined ? (patch.planOnly ? 1 : 0) : (cur.planOnly ? 1 : 0), now(), id);
      return this.get(id);
    },
    remove(id: string): void {
      db.prepare('DELETE FROM agents WHERE id = ?').run(id);
    }
  };
}
```

- [ ] **Step 4: 注册 IPC(修改 IpcRouter)**

```ts
const agents = createAgentStore(this.db);
this.register(IpcChannel.agentList, () => agents.list());
this.register(IpcChannel.agentCreate, (_e, input) => agents.create(input));
this.register(IpcChannel.agentUpdate, (_e, id, patch) => agents.update(id, patch));
this.register(IpcChannel.agentDelete, (_e, id) => agents.remove(id));
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd apps/desktop && pnpm vitest run src/main/ipc/agents.spec.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/ipc/agents.ts apps/desktop/src/main/ipc/agents.spec.ts apps/desktop/src/main/ipc/IpcRouter.ts
git commit -m "feat(agents): CRUD store and IPC (F1-F6 base fields)"
```

---

### Task 5: 工作区绑定 + JARVIS.md 生成(C7/L10) + 环境变量注入(C8)

**Files:**
- Create: `apps/desktop/src/main/ipc/workspace.ts`
- Create: `apps/desktop/src/main/ipc/workspace.spec.ts`
- Create: `packages/core/src/agent/context.ts`
- Create: `packages/core/src/agent/context.spec.ts`

**Interfaces:**
- Consumes: Task 4 agent store;M0 dialog.openFile。
- Produces:
  - `workspace.bind(agentId, path): Promise<void>` — 设置 agents.workspace_id;若路径无 `.jarvis/JARVIS.md` 则生成模板(§2.3 部署拓扑)。
  - `workspace.listBound(): { agentId; path }[]`
  - `loadAgentContext(agentId): Promise<{ jarvisMd: string; agentMd: string | null }>` — 读取 `{workspace}/.jarvis/JARVIS.md` 与 `.jarvis/agents/{slug}.md`(不存在返回空)。
  - `buildContextMessages(context: { jarvisMd; agentMd }, agentSystemPrompt, history): ModelMessage[]` — 将 JARVIS.md 并入 system。
  - IPC:workspace.bind、dialog.openFile(文件夹选择)。
  - C8 env merge:`mergeEnv(systemEnv, dotenv, agentEnv, multicaEnv)` 纯函数(注入测试)。

- [ ] **Step 1: 编写失败测试(context 纯函数)**

`packages/core/src/agent/context.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildContextMessages, mergeEnv } from './context';

describe('agent context', () => {
  it('merges env with precedence system < dotenv < agent < multica', () => {
    const merged = mergeEnv({ A: '1', S: 'sys' }, { A: '2' }, { A: '3', B: 'b' }, { A: '4' });
    expect(merged.A).toBe('4');
    expect(merged.B).toBe('b');
    expect(merged.S).toBe('sys');
  });

  it('builds system message with jarvis context', () => {
    const msgs = buildContextMessages({ jarvisMd: '# rules', agentMd: '# agent' }, 'be helpful', [{ role: 'user', content: 'hi' }]);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('# rules');
    expect(msgs[0].content).toContain('be helpful');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/core && pnpm vitest run src/agent/context.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 编写实现**

`packages/core/src/agent/context.ts`:
```ts
import type { ModelMessage } from '../model/types';

export function mergeEnv(system: Record<string, string>, dotenv: Record<string, string>, agent: Record<string, string>, multica: Record<string, string>): Record<string, string> {
  return { ...system, ...dotenv, ...agent, ...multica };
}

export interface AgentContextFiles { jarvisMd: string; agentMd: string | null }

export function buildContextMessages(ctx: AgentContextFiles, systemPrompt: string, history: Array<{ role: string; content: string }>): ModelMessage[] {
  const parts = [
    systemPrompt,
    ctx.jarvisMd ? `\n\n<workspace-context>\n${ctx.jarvisMd}\n</workspace-context>` : '',
    ctx.agentMd ? `\n\n<agent-context>\n${ctx.agentMd}\n</agent-context>` : ''
  ].filter(Boolean);
  return [
    { role: 'system', content: parts.join('\n') },
    ...history.map(h => ({ role: h.role as ModelMessage['role'], content: h.content }))
  ];
}
```

- [ ] **Step 4: 运行 context 测试确认通过**

Run: `cd packages/core && pnpm vitest run src/agent/context.spec.ts`
Expected: PASS。

- [ ] **Step 5: 编写 workspace IPC**

`apps/desktop/src/main/ipc/workspace.ts`:
```ts
import type Database from 'better-sqlite3';
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAgentStore } from './agents';

const JARVIS_MD_TEMPLATE = `# JARVIS 工作区上下文
更新此文件以记录本项目的构建、测试命令与约定,Agent 每次任务都会读取。`;

export function createWorkspaceService(db: Database.Database) {
  const agents = createAgentStore(db);

  return {
    bind(agentId: string, path: string): void {
      agents.update(agentId, { workspaceId: path });
      const dir = join(path, '.jarvis');
      mkdirSync(dir, { recursive: true });
      const md = join(dir, 'JARVIS.md');
      if (!existsSync(md)) writeFileSync(md, JARVIS_MD_TEMPLATE, 'utf8');
    },
    listBound(): Array<{ agentId: string; path: string }> {
      return agents.list().filter(a => a.workspaceId).map(a => ({ agentId: a.id, path: a.workspaceId! }));
    },
    loadContext(agentId: string): { jarvisMd: string; agentMd: string | null } {
      const agent = agents.get(agentId);
      if (!agent.workspaceId) return { jarvisMd: '', agentMd: null };
      const base = agent.workspaceId;
      let jarvisMd = '';
      try { jarvisMd = readFileSync(join(base, '.jarvis', 'JARVIS.md'), 'utf8'); } catch { /* ignore */ }
      let agentMd: string | null = null;
      try { agentMd = readFileSync(join(base, '.jarvis', 'agents', `${agent.slug}.md`), 'utf8'); } catch { /* ignore */ }
      return { jarvisMd, agentMd };
    }
  };
}
```

- [ ] **Step 6: 注册 IPC(修改 IpcRouter)**

```ts
const workspace = createWorkspaceService(this.db);
this.register('workspace.bind', (_e, agentId: string, path: string) => { workspace.bind(agentId, path); return { ok: true }; });
this.register('workspace.listBound', () => workspace.listBound());
this.register('workspace.loadContext', (_e, agentId: string) => workspace.loadContext(agentId));
this.register(IpcChannel.dialogOpenFile, async () => {
  const { dialog } = await import('electron');
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
```

- [ ] **Step 7: 运行全量 core 测试确认通过**

Run: `cd packages/core && pnpm vitest run`
Expected: 全部 PASS。

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/agent/context.ts packages/core/src/agent/context.spec.ts apps/desktop/src/main/ipc/workspace.ts apps/desktop/src/main/ipc/IpcRouter.ts
git commit -m "feat(workspace): bind workspace with JARVIS.md template and context loader (C7/L10), env merge (C8)"
```

---

### Task 6: Agent 管理页 + Agent 切换器(C2/K2) + ChatPage 接入真实 Agent 执行

**Files:**
- Create: `apps/desktop/src/renderer/src/stores/agent-store.ts`
- Create: `apps/desktop/src/renderer/src/components/agents/AgentSwitcher.tsx`
- Create: `apps/desktop/src/renderer/src/pages/AgentListView.tsx`
- Create: `apps/desktop/src/renderer/src/pages/AgentDetailPage.tsx`
- Create: `apps/desktop/src/renderer/src/stores/task-store.ts`
- Modify: `apps/desktop/src/renderer/src/pages/ChatPage.tsx`(接入 agentId 与 task 执行)
- Create: `apps/desktop/src/renderer/src/pages/AgentListView.spec.tsx`

**Interfaces:**
- Consumes: Task 4 agent IPC;Task 5 workspace IPC;M1 chat IPC。
- Produces:
  - `agent-store`(Zustand):`agents`、`current`、`refresh/create/update/remove/setCurrent`。
  - `AgentSwitcher`:侧边栏 Agent 列表,点击切换当前 Agent(写入当前会话的 agent 上下文)。
  - `AgentListView` + `AgentDetailPage`:创建/编辑/归档 Agent;绑定模型(model 下拉)、绑定工作区(dialog.openFile)。
  - `task-store`:发起 `chat.send` 前先确保 agentId;展示 task:log 流(底部日志面板)。
  - ChatPage 的 `chat.send` 现在携带真实 `agentId`;后端(M1 Task 7)已解析 agent 绑定模型。

- [ ] **Step 1: 编写 agent store**

`apps/desktop/src/renderer/src/stores/agent-store.ts`:
```ts
import { create } from 'zustand';
import type { AgentConfig } from '@jarvis/protocol';

interface AgentState {
  agents: AgentConfig[];
  current: AgentConfig | null;
  refresh: () => Promise<void>;
  create: (input: { name: string; systemPrompt: string; modelId: string | null; workspaceId: string | null }) => Promise<AgentConfig>;
  update: (id: string, patch: Partial<{ name: string; systemPrompt: string; modelId: string | null; workspaceId: string | null }>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setCurrent: (a: AgentConfig) => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  current: null,
  async refresh() {
    const agents = (await window.jarvis.invoke('agent.list')) as AgentConfig[];
    set({ agents, current: get().current ?? agents[0] ?? null });
  },
  async create(input) {
    const a = (await window.jarvis.invoke('agent.create', input)) as AgentConfig;
    set({ agents: [...get().agents, a], current: get().current ?? a });
    return a;
  },
  async update(id, patch) {
    await window.jarvis.invoke('agent.update', id, patch);
    await get().refresh();
  },
  async remove(id) {
    await window.jarvis.invoke('agent.delete', id);
    await get().refresh();
  },
  setCurrent(a) { set({ current: a }); }
}));
```

- [ ] **Step 2: 编写 AgentSwitcher**

`apps/desktop/src/renderer/src/components/agents/AgentSwitcher.tsx`:
```tsx
import { useEffect } from 'react';
import { useAgentStore } from '../../stores/agent-store';

export function AgentSwitcher() {
  const { agents, current, refresh, setCurrent } = useAgentStore();
  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div data-testid="agent-switcher">
      {agents.map(a => (
        <button key={a.id} data-testid={`agent-${a.slug}`} onClick={() => setCurrent(a)} style={{ fontWeight: current?.id === a.id ? 'bold' : 'normal' }}>
          {a.name}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: 编写 AgentListView(含绑定 UI)**

`apps/desktop/src/renderer/src/pages/AgentListView.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../stores/agent-store';
import { AgentDetailPage } from './AgentDetailPage';

export function AgentListView() {
  const { t } = useTranslation('common');
  const { agents, refresh } = useAgentStore();
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div data-testid="agent-list">
      <h2>{t('menu.agents')}</h2>
      {editing === '__new__' && <AgentDetailPage agentId={null} onClose={() => setEditing(null)} />}
      {editing && editing !== '__new__' && <AgentDetailPage agentId={editing} onClose={() => setEditing(null)} />}
      <ul>
        {agents.map(a => (
          <li key={a.id}>
            {a.name} <button onClick={() => setEditing(a.id)}>{t('common.edit')}</button>
          </li>
        ))}
      </ul>
      <button data-testid="agent-add" onClick={() => setEditing('__new__')}>{t('settings.provider.add')}</button>
    </div>
  );
}
```

`apps/desktop/src/renderer/src/pages/AgentDetailPage.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../stores/agent-store';

export function AgentDetailPage({ agentId, onClose }: { agentId: string | null; onClose: () => void }) {
  const { t } = useTranslation('common');
  const { agents, create, update } = useAgentStore();
  const existing = agents.find(a => a.id === agentId);
  const [name, setName] = useState(existing?.name ?? '');
  const [systemPrompt, setSystemPrompt] = useState(existing?.systemPrompt ?? '');
  const [modelId, setModelId] = useState<string | null>(existing?.modelId ?? null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(existing?.workspaceId ?? null);

  const pickWorkspace = async () => {
    const path = (await window.jarvis.invoke('dialog.openFile')) as string | null;
    if (path) { setWorkspaceId(path); if (agentId) await window.jarvis.invoke('workspace.bind', agentId, path); }
  };

  const save = async () => {
    if (agentId) await update(agentId, { name, systemPrompt, modelId, workspaceId });
    else await create({ name, systemPrompt, modelId, workspaceId });
    onClose();
  };

  return (
    <div data-testid="agent-detail">
      <input data-testid="agent-name" value={name} onChange={e => setName(e.target.value)} placeholder={t('settings.provider.name')} />
      <textarea data-testid="agent-prompt" value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} placeholder="System Prompt" />
      <input data-testid="agent-model" value={modelId ?? ''} onChange={e => setModelId(e.target.value || null)} placeholder="model id" />
      <button data-testid="agent-bind-workspace" onClick={() => void pickWorkspace()}>{workspaceId ?? 'Bind workspace'}</button>
      <button data-testid="agent-save" onClick={() => void save()}>{t('common.save')}</button>
    </div>
  );
}
```

- [ ] **Step 4: 编写失败测试**

`apps/desktop/src/renderer/src/pages/AgentListView.spec.tsx`:
```tsx
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { AgentListView } from './AgentListView';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
  (window as unknown as { jarvis: unknown }).jarvis = {
    invoke: async (m: string) => m === 'agent.list' ? [{ id: 'a1', name: 'Coder', slug: 'coder', description: '', systemPrompt: '', modelId: null, workspaceId: null, contextBudgetTokens: 1000, planOnly: false, createdAt: '', updatedAt: '' }] : [],
    onDidReceive: () => () => {}
  };
});

describe('AgentListView', () => {
  it('lists agents', async () => {
    render(<AgentListView />);
    await waitFor(() => expect(screen.getByText('Coder')).toBeTruthy());
  });
});
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/pages/AgentListView.spec.tsx`
Expected: PASS。

- [ ] **Step 6: 接入 ChatPage 与路由**

修改 `apps/desktop/src/renderer/src/pages/ChatPage.tsx`:侧边栏顶部渲染 `<AgentSwitcher />`,`chat.send` 携带 `agentId: useAgentStore.getState().current?.id`。修改 `apps/desktop/src/renderer/src/App.tsx` 路由,新增 `/agents`(AgentListView)。补充 i18n 键 `common.edit`。

- [ ] **Step 7: 运行类型检查 + 全量渲染测试**

Run: `cd apps/desktop && pnpm typecheck && pnpm vitest run`
Expected: 通过。

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/src/stores/agent-store.ts apps/desktop/src/renderer/src/components/agents apps/desktop/src/renderer/src/pages apps/desktop/src/renderer/src/App.tsx packages/i18n/locales
git commit -m "feat(agent-ui): agent list/detail with workspace binding and switcher (C2/K2)"
```

---

### Task 7: Task 流式执行接线:task:log 双通道(L5) + Task 取消/重试 UI(L4)

**Files:**
- Create: `apps/desktop/src/renderer/src/stores/task-store.ts`
- Create: `apps/desktop/src/renderer/src/components/tasks/TaskControlBar.tsx`
- Create: `apps/desktop/src/renderer/src/components/tasks/TaskControlBar.spec.tsx`
- Modify: `apps/desktop/src/main/ipc/tasks.ts`(新增,接线 TaskOrchestrator)

**Interfaces:**
- Consumes: Task 3 TaskOrchestrator;M1 chat IPC。
- Produces:
  - main `tasks.ts`:`registerTaskHandlers(ipc, db, secrets, agentStore)` — 维护单例 TaskOrchestrator;`task.create` 将入参转 SubmitInput;流式经 `task:log`/`task:state`/`task:complete` 事件推送;`task.cancel/pause/retry` 转发。
  - `task-store`(Zustand):`tasks`、`logs`、`createTask`、`cancel`、`retry`;订阅事件。
  - `TaskControlBar`:运行中 Task 显示取消/暂停按钮;失败显示重试。

- [ ] **Step 1: 编写 main 接线**

`apps/desktop/src/main/ipc/tasks.ts`:
```ts
import type { BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { IpcEvent } from '@jarvis/protocol';
import { AgentEngine, ToolRegistry, TaskOrchestrator } from '@jarvis/core';
import { createAdapter } from '@jarvis/core';
import { createAgentStore } from './agents';
import { createWorkspaceService } from './workspace';
import type { SecureStorage } from '../secrets/SecureStorage';
import type { AgentConfig } from '@jarvis/protocol';

export function registerTaskHandlers(db: Database.Database, secrets: SecureStorage, getWindow: () => BrowserWindow | null, agentStore = createAgentStore(db)) {
  const workspace = createWorkspaceService(db);
  const engine = new AgentEngine({ modelRouter: { chat: createAdapter('openai-compatible') as unknown as import('@jarvis/core').EngineChatFn }, toolRegistry: new ToolRegistry(), maxSteps: 10 });
  const store = {
    async create(id: string, agentId: string) {
      db.prepare('INSERT INTO tasks (id, agent_id, status, payload_json, created_at) VALUES (?,?,?,?,?)').run(id, agentId, 'queued', '{}', new Date().toISOString());
    },
    async updateState(id: string, state: string) { db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(state, id); },
    async appendLog(id: string, line: string) { getWindow()?.webContents.send(IpcEvent.taskLog, { id, line }); }
  };

  const orchestrator = new TaskOrchestrator(engine, store, {
    onStateChange: (id, state) => { getWindow()?.webContents.send(IpcEvent.taskState, { id, state }); },
    onLog: (id, line) => { getWindow()?.webContents.send(IpcEvent.taskLog, { id, line }); },
    onDone: (id, ok, text) => {
      db.prepare('UPDATE tasks SET status = ?, result_json = ?, completed_at = ? WHERE id = ?').run(ok ? 'completed' : 'failed', JSON.stringify({ text }), new Date().toISOString(), id);
      getWindow()?.webContents.send(ok ? IpcEvent.taskComplete : IpcEvent.taskFailed, { id, text });
    }
  }, 6);

  return {
    async create(event: Electron.IpcMainInvokeEvent, args: { agentId: string; prompt: string }) {
      const { agentId, prompt } = args;
      const id = randomUUID();
      const agent = agentStore.get(agentId);
      const ctx = workspace.loadContext(agentId);
      const messages = buildTaskMessages(ctx, agent, prompt);
      const modelRow = db.prepare('SELECT m.model_id, p.base_url, p.type, p.api_key_ref FROM models m JOIN providers p ON p.id = m.provider_id WHERE m.id = ?').get(agent.modelId) as { model_id: string; base_url: string; type: 'openai-compatible' | 'anthropic-compatible'; api_key_ref: string } | undefined;
      if (!modelRow) throw new Error('agent has no valid model binding');
      const apiKey = await secrets.get(modelRow.api_key_ref);
      if (!apiKey) throw new Error('missing api key');
      await store.create(id, agentId);
      orchestrator.submit({ id, agent, messages, cwd: agent.workspaceId ?? '.', env: {}, apiKey, provider: { type: modelRow.type, baseUrl: modelRow.base_url }, modelId: modelRow.model_id });
      return { id };
    },
    cancel: (_e: unknown, id: string) => orchestrator.cancel(id),
    pause: (_e: unknown, id: string) => orchestrator.pause(id),
    resume: (_e: unknown, id: string) => orchestrator.resume(id),
    retry: (_e: unknown, id: string) => orchestrator.retry(id)
  };
}

import { buildContextMessages } from '@jarvis/core';

function buildTaskMessages(ctx: { jarvisMd: string; agentMd: string | null }, agent: AgentConfig, prompt: string): Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }> {
  return buildContextMessages(ctx, agent.systemPrompt, [{ role: 'user', content: prompt }]);
}
```

- [ ] **Step 2: 注册 IPC(修改 IpcRouter)**

```ts
const taskHandlers = registerTaskHandlers(this.db, secrets, getWindow);
this.register(IpcChannel.taskCreate, (e, args) => taskHandlers.create(e, args));
this.register(IpcChannel.taskCancel, (_e, id) => taskHandlers.cancel(_e, id));
this.register(IpcChannel.taskPause, (_e, id) => taskHandlers.pause(_e, id));
this.register('task.resume', (_e, id) => taskHandlers.resume(_e, id));
this.register(IpcChannel.taskRetry, (_e, id) => taskHandlers.retry(_e, id));
```

- [ ] **Step 3: 编写 task-store + TaskControlBar**

`apps/desktop/src/renderer/src/stores/task-store.ts`:
```ts
import { create } from 'zustand';

interface TaskState {
  activeTaskId: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused' | null;
  logs: string[];
  createTask: (agentId: string, prompt: string) => Promise<string>;
  cancel: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  retry: () => Promise<void>;
  setStatus: (id: string, status: TaskState['status']) => void;
  appendLog: (line: string) => void;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  activeTaskId: null,
  status: null,
  logs: [],
  async createTask(agentId, prompt) {
    const { id } = (await window.jarvis.invoke('task.create', { agentId, prompt })) as { id: string };
    set({ activeTaskId: id, status: 'queued', logs: [] });
    return id;
  },
  async cancel() { if (get().activeTaskId) await window.jarvis.invoke('task.cancel', get().activeTaskId); },
  async pause() { if (get().activeTaskId) await window.jarvis.invoke('task.pause', get().activeTaskId); },
  async resume() { if (get().activeTaskId) await window.jarvis.invoke('task.resume', get().activeTaskId); },
  async retry() { if (get().activeTaskId) await window.jarvis.invoke('task.retry', get().activeTaskId); },
  setStatus(_id, status) { set({ status }); },
  appendLog(line) { set(s => ({ logs: [...s.logs, line] })); }
}));

if (typeof window !== 'undefined' && window.jarvis?.onDidReceive) {
  window.jarvis.onDidReceive('task:state', (p) => { const { id, state } = p as { id: string; state: TaskState['status'] }; useTaskStore.getState().setStatus(id, state); });
  window.jarvis.onDidReceive('task:log', (p) => { const { line } = p as { id: string; line: string }; useTaskStore.getState().appendLog(line); });
}
```

`apps/desktop/src/renderer/src/components/tasks/TaskControlBar.tsx`:
```tsx
import { useTranslation } from 'react-i18next';
import { useTaskStore } from '../../stores/task-store';

export function TaskControlBar() {
  const { t } = useTranslation('common');
  const { status, cancel, pause, resume, retry, logs } = useTaskStore();
  if (!status) return null;
  return (
    <div data-testid="task-control">
      <span data-testid="task-status">{status}</span>
      {status === 'running' && <button onClick={() => void cancel()}>{t('common.cancel')}</button>}
      {status === 'running' && <button onClick={() => void pause()}>⏸</button>}
      {status === 'paused' && <button onClick={() => void resume()}>▶</button>}
      {status === 'failed' && <button data-testid="task-retry" onClick={() => void retry()}>{t('common.ok')}</button>}
      <pre data-testid="task-logs">{logs.join('\n')}</pre>
    </div>
  );
}
```

- [ ] **Step 4: 编写失败测试**

`apps/desktop/src/renderer/src/components/tasks/TaskControlBar.spec.tsx`:
```tsx
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import { TaskControlBar } from './TaskControlBar';
import { useTaskStore } from '../../stores/task-store';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ resources: getResources(), lng: 'zh-CN', ns: ['common'], defaultNS: 'common' });
});

describe('TaskControlBar', () => {
  it('shows retry on failed state', () => {
    useTaskStore.setState({ status: 'failed' });
    render(<TaskControlBar />);
    expect(screen.getByTestId('task-retry')).toBeTruthy();
  });
  it('hides when no task', () => {
    useTaskStore.setState({ status: null });
    const { container } = render(<TaskControlBar />);
    expect(container.querySelector('[data-testid="task-control"]')).toBeNull();
  });
});
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/components/tasks/TaskControlBar.spec.tsx`
Expected: PASS。

- [ ] **Step 6: 在 ChatPage 底部挂载 TaskControlBar 并补充 i18n `common.edit`/`common.cancel`(已在 zh-CN/en)**

修改 ChatPage:在输入区下方渲染 `<TaskControlBar />`。

- [ ] **Step 7: 运行全量测试确认通过**

Run: `cd /Users/baofengbaofeng/Workspace/github/baofengbaofeng/Jarvis && pnpm -r test`
Expected: 全部 PASS。

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/main/ipc/tasks.ts apps/desktop/src/main/ipc/IpcRouter.ts apps/desktop/src/renderer/src/stores/task-store.ts apps/desktop/src/renderer/src/components/tasks apps/desktop/src/renderer/src/pages/ChatPage.tsx
git commit -m "feat(task): streaming task execution wired to chat with cancel/pause/retry UI (L4/L5)"
```

---

### M2 验收清单(Self-Review 对照)

对照技术文档 §21 M2 与 §10.6:

- [x] F1–F6 Agent 自定义/指令/绑模型/工作区/工具策略字段(Task 4/5/6)
- [x] F12 手动触发(Task 7 `task.create` via chat)
- [x] F13 执行日志流(Task 7 task:log)
- [x] F14 队列 + per-agent 并发(Task 3)
- [x] K2 Agent 切换器(Task 6)
- [x] C2 Agent 管理页(Task 6)
- [x] C7 工作区绑定(Task 5)
- [x] C8 环境变量注入(mergeEnv 纯函数,Task 5)
- [x] L4 Task 取消/暂停/重试(Task 3/7)
- [x] L5 流式双通道 chat:delta + task:log(Task 7)
- [x] L10 JARVIS.md 模板生成与注入(Task 5)
- [x] AgentEngine v1 REACT loop(Task 2)

**M2 已知后置:** read_file/write_file/run_shell 工具与 ToolRegistry 真正填充(M3核心 Task 1);MCP/Skills(M3核心);daemon 并发调度(M7);Agent 模板/版本历史(M6/M8);@引用(M4)。
