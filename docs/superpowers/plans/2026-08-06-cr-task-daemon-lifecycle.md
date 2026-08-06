# CR Task 与 Daemon 生命周期整改 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 BP-01、BP-07、PERF-01、MAINT-01～06，使暂停成为可确认的协作式 barrier，renderer 状态按 taskId 隔离，所有 `tasks` SQLite transition 只由 daemon transaction 写入，并收敛 daemon、审批与 Multica 并发生命周期。

**Architecture:** 本地 `AgentEngine`/REACT loop 继续且只在 Electron main 的 TypeScript 进程执行；Go 不复制引擎。Electron main 通过带随机 Bearer token、仅监听 `127.0.0.1` 的 daemon task API 创建及迁移任务状态，daemon 在单一 SQLite transaction 中校验状态机并写 `tasks`；main 可继续只读任务表。暂停由 core 的 `CooperativeRunControl` 在模型、审批、工具前后建立 safe point：暂停请求先中止当前可取消操作，再等待引擎到达 barrier，得到确认后才持久化 `paused`；checkpoint 只记录已完成的模型 turn/tool result，resume 不重放已完成副作用。

**Tech Stack:** TypeScript 5、Vitest、Electron 32、Zustand 5、Go 1.25、`net/http`、`database/sql`、SQLite WAL；不增加第三方依赖。

## Global Constraints

- `AgentEngine`、REACT loop、`ModelRouter`、`MCPClient` 唯一实现在 `packages/core` TypeScript；Go 只做协议、调度与持久化壳。
- 本地任务的模型和工具执行仍在 Electron main；不得把本地任务改为 spawn `jarvis-agent`。
- `tasks` 是 daemon-owned 表；本计划完成后 Electron main 对 `tasks` 只读，所有 INSERT/UPDATE/DELETE 均由 daemon transaction 执行。
- daemon API 只绑定 `127.0.0.1`，除 `/health` 外必须校验 `Authorization: Bearer <JARVIS_DAEMON_TOKEN>`；失败不得回退为 main 直写。
- SQLite migration 只追加 v13+；本计划不需要改 schema，不修改 v1–v12。
- Renderer 只能从 `@jarvis/core/renderer` 导入 pure 模块；本计划 renderer 不新增 core import。
- Provider/model ID 由用户配置，不新增默认 model ID；API key 只留在 main/Keychain，不进入 daemon payload、checkpoint、日志或 SQLite。
- 新增用户可见文案必须 zh-CN/en 对称；本计划新增错误均为内部稳定 code，不新增 UI 文案。
- 每个 Task 严格 Red → Green；只暂存本 Task 列出的文件，不夹带当前工作树已有改动。

## 文件结构与接口总览

| 文件 | 责任 |
|---|---|
| `packages/core/src/task/CooperativeRunControl.ts` | pause/cancel 仲裁、当前操作 AbortSignal、barrier 确认与 resume gate |
| `packages/core/src/agent/AgentEngine.ts` | 模型/审批/工具前后 safe point；产出可持久化 checkpoint |
| `packages/core/src/task/TaskOrchestrator.ts` | 每任务 control、暂停确认、终态资源回收、有界 retry cache |
| `apps/desktop/src/renderer/src/stores/task-store.ts` | `statuses/logsByTaskId`，active task 仅为 selector |
| `daemon/internal/taskstore/store.go` | daemon-owned tasks 状态机与 SQLite transaction |
| `daemon/internal/httpapi/tasks.go` | 本地认证 task REST API |
| `apps/desktop/src/main/daemon/DaemonTaskClient.ts` | main→daemon typed client |
| `apps/desktop/src/main/ipc/tasks.ts` | 解析本地 run，执行 TS engine，把 transition/checkpoint 转发 daemon |
| `apps/desktop/src/main/daemon/DaemonSupervisor.ts` | spawn generation、等待退出的 restart、task client 与 injection sync |
| `apps/desktop/src/main/approval/ApprovalCenter.ts` | resolve/timeout/abort/dispose 共用 finalize |
| `daemon/cmd/jarvis-daemon/main.go` | busy 从 queue active count 推导；真实 local injection source 接线 |
| `daemon/internal/multica/client/client.go` | registration 的全部读写统一通过锁保护 accessor |

---

### Task 1: CooperativeRunControl 与 AgentEngine safe points（BP-01）

**Files:**
- Create: `packages/core/src/task/CooperativeRunControl.ts`
- Create: `packages/core/src/task/CooperativeRunControl.spec.ts`
- Modify: `packages/core/src/agent/AgentEngine.ts`
- Modify: `packages/core/src/agent/AgentEngine.spec.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  - `EngineSafePoint = 'before-model' | 'after-model' | 'before-approval' | 'after-approval' | 'before-tool' | 'after-tool'`
  - `EngineCheckpoint { safePoint; messages; nextStep; toolCalls; finalText; usage }`
  - `CooperativeRunControl.pause(): Promise<EngineCheckpoint>`：只有引擎进入 barrier 后 resolve。
  - `CooperativeRunControl.resume(): void`
  - `CooperativeRunControl.cancel(reason?): void`
  - `CooperativeRunControl.checkpoint(snapshot): Promise<void>`
  - `CooperativeRunControl.runInterruptible(kind, fn): Promise<{ kind:'value'; value:T } | { kind:'paused' }>`
  - `EngineRunInput.control?: CooperativeRunControl`
  - `EngineRunInput.checkpoint?: EngineCheckpoint`
  - `EngineRunInput.onCheckpoint?: (checkpoint: EngineCheckpoint) => Promise<void> | void`
- Invariant: pause 中止模型/审批/工具当前 AbortSignal；模型和审批在 resume 后可重新发起，已开始的工具调用不会重放，而是写入一次带原 tool-call id 的 interrupted result 后从下一 safe point 继续。
- Prerequisite: 先完成 CR Engine/Tool plan 的 provider-neutral assistant tool turn；下面 `ModelMessage`/`toolCallId` 使用该 plan 的最终类型。

- [ ] **Step 1: 写 pause barrier 的失败测试**

`packages/core/src/task/CooperativeRunControl.spec.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  CooperativeRunControl,
  type EngineCheckpoint,
} from './CooperativeRunControl';

const checkpoint = (safePoint: EngineCheckpoint['safePoint']): EngineCheckpoint => ({
  safePoint,
  messages: [{ role: 'user', content: 'go' }],
  nextStep: 0,
  toolCalls: 0,
  finalText: '',
  usage: null,
});

describe('CooperativeRunControl', () => {
  it('aborts the current operation and acknowledges pause only at a checkpoint', async () => {
    const control = new CooperativeRunControl();
    const aborted = vi.fn();
    const operation = control.runInterruptible('model', async (signal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => {
          aborted();
          resolve();
        }, { once: true });
      });
      throw signal.reason;
    });

    const pause = control.pause();
    await expect(operation).resolves.toEqual({ kind: 'paused' });
    expect(aborted).toHaveBeenCalledOnce();

    let acknowledged = false;
    void pause.then(() => { acknowledged = true; });
    await Promise.resolve();
    expect(acknowledged).toBe(false);

    const barrier = control.checkpoint(checkpoint('before-model'));
    await expect(pause).resolves.toMatchObject({ safePoint: 'before-model' });
    expect(acknowledged).toBe(true);

    control.resume();
    await expect(barrier).resolves.toBeUndefined();
  });

  it('cancel wins over pause and rejects the barrier', async () => {
    const control = new CooperativeRunControl();
    const pause = control.pause();
    const barrier = control.checkpoint(checkpoint('before-tool'));
    await pause;
    control.cancel(new DOMException('cancelled', 'AbortError'));
    await expect(barrier).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects a pending pause acknowledgement when cancellation wins before a safe point', async () => {
    const control = new CooperativeRunControl();
    const pause = control.pause();
    control.cancel(new DOMException('cancelled', 'AbortError'));
    await expect(pause).rejects.toMatchObject({ name: 'AbortError' });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/core && pnpm vitest run src/task/CooperativeRunControl.spec.ts`

Expected: FAIL with `Cannot find module './CooperativeRunControl'`.

- [ ] **Step 3: 实现 control、barrier 与 signal linking**

`packages/core/src/task/CooperativeRunControl.ts`：

```ts
import type { ModelMessage, Usage } from '../model/types';

export type EngineSafePoint =
  | 'before-model'
  | 'after-model'
  | 'before-approval'
  | 'after-approval'
  | 'before-tool'
  | 'after-tool';

export interface EngineCheckpoint {
  safePoint: EngineSafePoint;
  messages: ModelMessage[];
  nextStep: number;
  toolCalls: number;
  finalText: string;
  usage: Usage | null;
}

type OperationKind = 'model' | 'approval' | 'tool';
type InterruptibleResult<T> = { kind: 'value'; value: T } | { kind: 'paused' };

export class CooperativeRunControl {
  private pauseRequested = false;
  private cancelled: unknown;
  private active: AbortController | null = null;
  private pauseWaiters: Array<{
    resolve: (checkpoint: EngineCheckpoint) => void;
    reject: (reason: unknown) => void;
  }> = [];
  private resumeGate: { promise: Promise<void>; resolve: () => void } | null = null;

  async pause(): Promise<EngineCheckpoint> {
    if (this.cancelled) throw this.cancelled;
    if (!this.pauseRequested) {
      this.pauseRequested = true;
      this.resumeGate = this.deferred();
      this.active?.abort(new DOMException('paused', 'AbortError'));
    }
    return new Promise<EngineCheckpoint>((resolve, reject) => {
      this.pauseWaiters.push({ resolve, reject });
    });
  }

  resume(): void {
    if (this.cancelled) return;
    this.pauseRequested = false;
    this.pauseWaiters = [];
    this.resumeGate?.resolve();
    this.resumeGate = null;
  }

  cancel(reason: unknown = new DOMException('cancelled', 'AbortError')): void {
    this.cancelled = reason;
    this.active?.abort(reason);
    this.resumeGate?.resolve();
    this.resumeGate = null;
    for (const waiter of this.pauseWaiters.splice(0)) waiter.reject(reason);
  }

  async checkpoint(snapshot: EngineCheckpoint): Promise<void> {
    if (this.cancelled) throw this.cancelled;
    if (!this.pauseRequested) return;
    for (const waiter of this.pauseWaiters.splice(0)) {
      waiter.resolve(structuredClone(snapshot));
    }
    await this.resumeGate?.promise;
    if (this.cancelled) throw this.cancelled;
  }

  async runInterruptible<T>(
    _kind: OperationKind,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<InterruptibleResult<T>> {
    if (this.cancelled) throw this.cancelled;
    if (this.pauseRequested) return { kind: 'paused' };
    const controller = new AbortController();
    this.active = controller;
    try {
      return { kind: 'value', value: await fn(controller.signal) };
    } catch (error) {
      if (this.pauseRequested && controller.signal.aborted) return { kind: 'paused' };
      throw error;
    } finally {
      if (this.active === controller) this.active = null;
    }
  }

  private deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    return { promise, resolve };
  }
}
```

- [ ] **Step 4: 运行 control 测试确认通过**

Run: `cd packages/core && pnpm vitest run src/task/CooperativeRunControl.spec.ts`

Expected: PASS, 2 tests.

- [ ] **Step 5: 写 AgentEngine “暂停后无副作用、resume 不重复工具”失败测试**

追加到 `packages/core/src/agent/AgentEngine.spec.ts`：

```ts
import { vi } from 'vitest';
import { CooperativeRunControl } from '../task/CooperativeRunControl';

it('acknowledges pause before a tool side effect and resumes without replaying completed tools', async () => {
  const reg = new ToolRegistry();
  const effects: string[] = [];
  let releaseFirstTool!: () => void;
  const firstTool = new Promise<void>((resolve) => { releaseFirstTool = resolve; });
  reg.register({ name: 'effect', description: '', parameters: {} }, async (_args, ctx) => {
    await firstTool;
    if (ctx.signal?.aborted) throw ctx.signal.reason;
    effects.push('effect');
    return { ok: true, output: 'done' };
  });

  let modelCalls = 0;
  const chat = async (_req: unknown, opts: { onChunk?: (c: ChatChunk) => void }) => {
    modelCalls++;
    if (modelCalls === 1) {
      opts.onChunk?.({ kind: 'tool_call', toolCalls: [{ id: 'call-1', name: 'effect', arguments: {} }] });
      return { text: '', usage: null };
    }
    opts.onChunk?.({ kind: 'done' });
    return { text: 'complete', usage: null };
  };
  const control = new CooperativeRunControl();
  const checkpoints: string[] = [];
  const engine = new AgentEngine({ modelRouter: { chat }, toolRegistry: reg });
  const run = engine.run({
    agent,
    messages: [{ role: 'user', content: 'go' }],
    cwd: '/',
    env: {},
    apiKey: 'sk',
    provider: { type: 'openai-compatible', baseUrl: 'https://x.com' },
    modelId: 'm1',
    toolAuthorization: Object.freeze({
      agentId: agent.id,
      allowedToolNames: Object.freeze(['effect']),
    }),
    control,
    onCheckpoint: (cp) => { checkpoints.push(cp.safePoint); },
  });

  await vi.waitFor(() => expect(modelCalls).toBe(1));
  const paused = control.pause();
  releaseFirstTool();
  await expect(paused).resolves.toMatchObject({ safePoint: 'after-tool' });
  expect(effects).toEqual([]);
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(modelCalls).toBe(1);

  control.resume();
  await expect(run).resolves.toMatchObject({ text: 'complete', toolCalls: 1 });
  expect(effects).toEqual([]);
  expect(modelCalls).toBe(2);
  expect(checkpoints).toContain('after-tool');
});
```

- [ ] **Step 6: 运行 AgentEngine 测试确认失败**

Run: `cd packages/core && pnpm vitest run src/agent/AgentEngine.spec.ts -t "acknowledges pause"`

Expected: FAIL because `EngineRunInput` has no `control`/`onCheckpoint` and the engine never enters a pause barrier.

- [ ] **Step 7: 在 AgentEngine 加入精确 safe-point 循环**

在 `packages/core/src/agent/AgentEngine.ts` 增加 imports 与字段：

```ts
import {
  CooperativeRunControl,
  type EngineCheckpoint,
  type EngineSafePoint,
} from '../task/CooperativeRunControl';

export interface EngineRunInput {
  // existing fields remain
  control?: CooperativeRunControl;
  checkpoint?: EngineCheckpoint;
  onCheckpoint?: (checkpoint: EngineCheckpoint) => Promise<void> | void;
}
```

用下面的 checkpoint helpers 初始化 `run()` 的工作状态：

```ts
const control = input.control ?? new CooperativeRunControl();
const onInputAbort = () => control.cancel(input.signal?.reason);
if (input.signal?.aborted) onInputAbort();
else input.signal?.addEventListener('abort', onInputAbort, { once: true });
let working = input.checkpoint
  ? structuredClone(input.checkpoint.messages)
  : structuredClone(messages);
let step = input.checkpoint?.nextStep ?? 0;
let toolCalls = input.checkpoint?.toolCalls ?? 0;
let totalUsage = input.checkpoint?.usage ?? null;
let finalText = input.checkpoint?.finalText ?? '';

const safePoint = async (point: EngineSafePoint, nextStep = step): Promise<void> => {
  const snapshot: EngineCheckpoint = {
    safePoint: point,
    messages: structuredClone(working),
    nextStep,
    toolCalls,
    finalText,
    usage: totalUsage,
  };
  await input.onCheckpoint?.(snapshot);
  await control.checkpoint(snapshot);
};

const buildRequest = (currentMessages: ModelMessage[]): ChatRequest => ({
  provider: {
    id: agent.id,
    name: agent.name,
    type: input.provider.type,
    baseUrl: input.provider.baseUrl,
    apiKeyRef: '',
    createdAt: '',
    updatedAt: '',
  },
  modelId: input.modelId,
  messages: currentMessages,
  stream: true,
  maxTokens: this.cfg.maxTokens,
  tools: [...tools.list()],
  toolChoice: 'auto',
});

const assistantTurn = (content: string, calls: ToolCall[]): AssistantToolTurn => ({
  role: 'assistant',
  content,
  toolCalls: Object.freeze(calls.map((call) => ({
    ...call,
    arguments: structuredClone(call.arguments),
  }))),
});

const toolResultTurn = (
  call: ToolCall,
  content: string,
  isError: boolean,
): ToolResultTurn => ({
  role: 'tool',
  toolCallId: call.id,
  name: call.name,
  content,
  isError,
});
```

用下面的控制流替换原 `for` loop；`assistantTurn` 与 `toolResultTurn` 使用 CR Engine/Tool plan 产出的 structured turn constructors：

```ts
while (step < this.maxSteps) {
  await safePoint('before-model');
  let modelResult:
    | { kind: 'value'; value: { text: string; usage: Usage | null; calls: ToolCall[] } }
    | { kind: 'paused' };
  do {
    const callCalls: ToolCall[] = [];
    modelResult = await control.runInterruptible('model', async (operationSignal) => {
      const result = await this.cfg.modelRouter.chat(buildRequest(working), {
        apiKey,
        signal: operationSignal,
        onChunk: (chunk) => {
          if (chunk.kind === 'delta') onDelta?.(chunk.delta);
          if (chunk.kind === 'tool_call') callCalls.push(...chunk.toolCalls);
          if (chunk.kind === 'usage') totalUsage = chunk.usage;
        },
      });
      return { ...result, calls: callCalls };
    });
    if (modelResult.kind === 'paused') await safePoint('before-model');
  } while (modelResult.kind === 'paused');

  const { text, usage, calls } = modelResult.value;
  if (text || calls.length) working.push(assistantTurn(text, calls));
  if (text) finalText += text;
  if (usage) totalUsage = usage;
  await safePoint('after-model');
  if (calls.length === 0) break;

  for (const call of calls) {
    toolCalls++;
    await safePoint('before-approval');
    let approved = true;
    if (this.cfg.approvalGate) {
      let decision;
      do {
        decision = await control.runInterruptible(
          'approval',
          (operationSignal) => this.cfg.approvalGate!({
            toolName: call.name,
            args: call.arguments,
            prompt: `run ${call.name}`,
            agent: input.agent,
            signal: operationSignal,
          }),
        );
        if (decision.kind === 'paused') await safePoint('before-approval');
      } while (decision.kind === 'paused');
      approved = decision.value;
    }
    await safePoint('after-approval');
    if (!approved) {
      working.push(toolResultTurn(call, `[denied] ${call.name}`, true));
      await safePoint('after-tool');
      continue;
    }

    await safePoint('before-tool');
    const executed = await control.runInterruptible(
      'tool',
      (operationSignal) => tools.execute(call, {
        cwd,
        env,
        signal: operationSignal,
        workspaceRoot,
        policy,
        agent: input.agent,
      }),
    );
    if (executed.kind === 'paused') {
      working.push(toolResultTurn(
        call,
        `[interrupted by pause] ${call.name} was not replayed`,
        true,
      ));
      await safePoint('after-tool');
      continue;
    }
    onTool?.(call, executed.value);
    working.push(toolResultTurn(call, executed.value.output, !executed.value.ok));
    await safePoint('after-tool');
  }
  step++;
}
return { text: finalText, toolCalls, usage: totalUsage };
```

完整 run loop 必须由 `try/finally` 包裹，并在 `finally` 执行
`input.signal?.removeEventListener('abort', onInputAbort)`；否则长期任务会把 abort listener 留在调用方 signal 上。

同时把 `AgentEngineConfig.approvalGate` 的签名改为接受 `ApprovalRequest & { signal: AbortSignal }`，并在 `packages/core/src/index.ts` 追加：

```ts
export * from './task/CooperativeRunControl';
```

- [ ] **Step 8: 运行 core 目标测试**

Run: `cd packages/core && pnpm vitest run src/task/CooperativeRunControl.spec.ts src/agent/AgentEngine.spec.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/task/CooperativeRunControl.ts packages/core/src/task/CooperativeRunControl.spec.ts packages/core/src/agent/AgentEngine.ts packages/core/src/agent/AgentEngine.spec.ts packages/core/src/index.ts
git commit -m "fix: add cooperative pause barriers to agent runs"
```

---

### Task 2: TaskOrchestrator 暂停确认、checkpoint 与终态回收（BP-01、PERF-01）

**Files:**
- Modify: `packages/core/src/task/TaskOrchestrator.ts`
- Modify: `packages/core/src/task/TaskOrchestrator.spec.ts`

**Interfaces:**
- Consumes: Task 1 `CooperativeRunControl`/`EngineCheckpoint`。
- Replaces `TaskStoreAdapter.updateState` with:
  - `transition(id, event, patch?): Promise<TaskState>`
  - `checkpoint(id, checkpoint): Promise<void>`
- Produces:
  - `RetryInputSource.load(id): Promise<SubmitInput | null>`
  - `TaskOrchestrator.resourceCounts(): { queued; states; controllers; controls; retryInputs; activeAgents }`
  - terminal cleanup removes queue/controller/control/state and zero-valued active-agent entries。
- `activeTaskIds` 明确记录已占用并发 slot 的 task；`finalize` 先 delete 并检查返回值，保证 running cancel 与 `runOne.finally` 竞态时每个 slot 只递减一次。
  - in-memory retry cache upper bound is exactly 128; cache miss rebuilds through `RetryInputSource`。
- 生产调用方在首次 `submit` 前先 await `Store.Create`；retry 复用现有 task row：transition `retry` 后只重新 enqueue，不得再次 `Store.Create` 同一主键。

- [ ] **Step 1: 用失败测试固定 pause 与 10k 终态回收**

在 `packages/core/src/task/TaskOrchestrator.spec.ts` 替换旧“paused task still completes”测试，并追加资源测试：

```ts
import { vi } from 'vitest';
import type { SubmitInput } from './TaskOrchestrator';

function makeInput(id: string): SubmitInput {
  return {
    id,
    agent: {
      id: 'a1', name: 'A', slug: 'a', description: '', systemPrompt: '',
      modelId: 'm1', workspaceId: null, contextBudgetTokens: 1_000,
      planOnly: false, createdAt: '', updatedAt: '',
    },
    messages: [{ role: 'user', content: 'go' }],
    cwd: '/',
    env: {},
    apiKey: 'sk',
    provider: { type: 'openai-compatible', baseUrl: 'https://example.test' },
    modelId: 'm1',
    toolAuthorization: Object.freeze({
      agentId: 'a1',
      allowedToolNames: Object.freeze([]),
    }),
  };
}

function makeTransactionalStore(): TaskStoreAdapter {
  const states = new Map<string, TaskState>();
  const next: Record<TaskTransitionEvent, TaskState> = {
    start: 'running',
    pause: 'paused',
    resume: 'running',
    cancel: 'cancelled',
    complete: 'completed',
    fail: 'failed',
    retry: 'queued',
    rollback: 'failed',
  };
  return {
    async create(id) { states.set(id, 'queued'); },
    async transition(id, event) {
      const state = next[event];
      states.set(id, state);
      return state;
    },
    async checkpoint() {},
    async appendLog() {},
  };
}

it('does not persist paused until the engine acknowledges its barrier', async () => {
  let releaseModel!: () => void;
  const modelGate = new Promise<void>((resolve) => { releaseModel = resolve; });
  const reg = new ToolRegistry();
  const engine = new AgentEngine({
    modelRouter: {
      chat: async (_req, opts) => {
        await Promise.race([
          modelGate,
          new Promise((_, reject) => opts.signal?.addEventListener(
            'abort',
            () => reject(opts.signal?.reason),
            { once: true },
          )),
        ]);
        return { text: 'done', usage: null };
      },
    },
    toolRegistry: reg,
  });
  const events: string[] = [];
  const store: TaskStoreAdapter = {
    async create() {},
    async transition(_id, event) {
      events.push(event);
      return event === 'start' ? 'running' : event === 'pause' ? 'paused' : 'completed';
    },
    async checkpoint() {},
    async appendLog() {},
  };
  const orb = new TaskOrchestrator(engine, store, {}, 1);
  orb.submit(makeInput('t1'));
  await vi.waitFor(() => expect(events).toContain('start'));

  const paused = orb.pause('t1');
  await expect(paused).resolves.toMatchObject({ safePoint: 'before-model' });
  expect(events).toContain('pause');
  releaseModel();
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(events).not.toContain('complete');

  await orb.resume('t1');
  await vi.waitFor(() => expect(events).toContain('complete'));
});

it('reclaims terminal maps and bounds retry inputs after ten thousand tasks', async () => {
  const engine = new AgentEngine({
    modelRouter: { chat: async () => ({ text: 'ok', usage: null }) },
    toolRegistry: new ToolRegistry(),
  });
  const store = makeTransactionalStore();
  const completed = new Set<string>();
  const orb = new TaskOrchestrator(engine, store, {
    onDone: (id) => { completed.add(id); },
  }, 100);

  for (let i = 0; i < 10_000; i++) orb.submit(makeInput(`t-${i}`));
  await vi.waitFor(() => expect(completed.size).toBe(10_000), { timeout: 10_000 });
  expect(orb.resourceCounts()).toEqual({
    queued: 0,
    states: 0,
    controllers: 0,
    controls: 0,
    retryInputs: 128,
    activeAgents: 0,
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/core && pnpm vitest run src/task/TaskOrchestrator.spec.ts`

Expected: FAIL on missing `transition`, `checkpoint`, `resourceCounts`, and old pause semantics.

- [ ] **Step 3: 实现有界 retry cache 和统一 finalize**

在 `TaskOrchestrator.ts` 增加：

```ts
import {
  CooperativeRunControl,
  type EngineCheckpoint,
} from './CooperativeRunControl';

export type TaskTransitionEvent =
  | 'start' | 'pause' | 'resume' | 'cancel'
  | 'complete' | 'fail' | 'retry' | 'rollback';

export interface TaskStoreAdapter {
  create(id: string, agentId: string, payload?: Record<string, unknown>): Promise<void>;
  transition(
    id: string,
    event: TaskTransitionEvent,
    patch?: { result?: unknown; error?: unknown },
  ): Promise<TaskState>;
  checkpoint(id: string, checkpoint: EngineCheckpoint): Promise<void>;
  appendLog(id: string, line: string): Promise<void>;
}

export interface RetryInputSource {
  load(id: string): Promise<SubmitInput | null>;
}

class BoundedRetryInputs {
  private readonly values = new Map<string, SubmitInput>();
  constructor(private readonly max = 128) {}
  set(id: string, input: SubmitInput): void {
    this.values.delete(id);
    this.values.set(id, input);
    while (this.values.size > this.max) {
      const oldest = this.values.keys().next().value as string;
      this.values.delete(oldest);
    }
  }
  get(id: string): SubmitInput | undefined {
    const value = this.values.get(id);
    if (value) {
      this.values.delete(id);
      this.values.set(id, value);
    }
    return value;
  }
  get size(): number { return this.values.size; }
}
```

把任务资源改为：

```ts
private controls = new Map<string, CooperativeRunControl>();
private retryInputs = new BoundedRetryInputs(128);
private activeTaskIds = new Set<string>();

constructor(
  private engine: AgentEngine,
  private store: TaskStoreAdapter,
  private cb: TaskOrchestratorCallbacks = {},
  private perAgent: number = DEFAULT_CONCURRENCY_PER_AGENT,
  private retrySource?: RetryInputSource,
) {}

resourceCounts() {
  return {
    queued: this.queue.length,
    states: this.states.size,
    controllers: this.controllers.size,
    controls: this.controls.size,
    retryInputs: this.retryInputs.size,
    activeAgents: this.active.size,
  };
}

private finalize(id: string, agentId: string): void {
  this.queue = this.queue.filter((item) => item.input.id !== id);
  this.controllers.delete(id);
  this.controls.delete(id);
  this.states.delete(id);
  if (!this.activeTaskIds.delete(id)) return;
  const count = Math.max(0, (this.active.get(agentId) ?? 0) - 1);
  if (count === 0) this.active.delete(agentId);
  else this.active.set(agentId, count);
}
```

`submit/runOne/pause/resume/cancel/retry` 使用以下关键实现：

```ts
submit(input: SubmitInput): void {
  this.enqueue(input);
}

private enqueue(input: SubmitInput): void {
  const controller = new AbortController();
  const control = new CooperativeRunControl();
  this.retryInputs.set(input.id, input);
  this.states.set(input.id, 'queued');
  this.controllers.set(input.id, controller);
  this.controls.set(input.id, control);
  this.queue.push({ input, controller, control });
  this.cb.onStateChange?.(input.id, 'queued');
  void this.pump();
}

async pause(id: string): Promise<EngineCheckpoint> {
  if (this.states.get(id) !== 'running') throw new Error(`task ${id} is not running`);
  const checkpoint = await this.controls.get(id)!.pause();
  const state = await this.store.transition(id, 'pause');
  this.states.set(id, state);
  this.cb.onStateChange?.(id, state);
  return checkpoint;
}

async resume(id: string): Promise<void> {
  if (this.states.get(id) !== 'paused') throw new Error(`task ${id} is not paused`);
  const state = await this.store.transition(id, 'resume');
  this.states.set(id, state);
  this.controls.get(id)!.resume();
  this.cb.onStateChange?.(id, state);
}

async cancel(id: string): Promise<void> {
  const state = this.states.get(id);
  if (!state) return;
  this.controllers.get(id)?.abort(new DOMException('cancelled', 'AbortError'));
  this.controls.get(id)?.cancel(new DOMException('cancelled', 'AbortError'));
  const next = await this.store.transition(id, 'cancel');
  this.states.set(id, next);
  this.cb.onStateChange?.(id, next);
  const input = this.retryInputs.get(id);
  if (input && state === 'queued') this.finalize(id, input.agent.id);
}

async retry(id: string): Promise<void> {
  const input = this.retryInputs.get(id) ?? await this.retrySource?.load(id);
  if (!input) throw new Error(`retry input unavailable for task ${id}`);
  await this.store.transition(id, 'retry');
  this.enqueue(input);
}
```

`runOne` 调用：

```ts
const result = await this.engine.run({
  ...input,
  signal: controller.signal,
  control,
  onCheckpoint: (checkpoint) => this.store.checkpoint(input.id, checkpoint),
  onDelta: (delta) => {
    this.cb.onLog?.(input.id, delta);
    void this.store.appendLog(input.id, delta);
  },
});
```

`runOne` 真正取得 slot 时先 `activeTaskIds.add(id)`。成功/失败分别调用 `store.transition(id, 'complete', { result })` / `store.transition(id, 'fail', { error })`；`finally` 必须调用 `finalize(input.id, input.agent.id)` 后 `pump()`。queued cancel 在 `runOne` 前从 queue 删除并 finalize，但因尚未加入 `activeTaskIds` 不递减 active；running cancel 只发 abort/transition，由 `runOne.finally` 唯一释放 slot。

- [ ] **Step 4: 运行目标测试确认通过**

Run: `cd packages/core && pnpm vitest run src/task/TaskOrchestrator.spec.ts src/task/TaskStateMachine.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/task/TaskOrchestrator.ts packages/core/src/task/TaskOrchestrator.spec.ts
git commit -m "fix: reclaim task resources after terminal states"
```

---

### Task 3: Renderer 按 taskId 投影状态与日志（BP-07）

**Files:**
- Modify: `apps/desktop/src/renderer/src/stores/task-store.ts`
- Modify: `apps/desktop/src/renderer/src/stores/task-store.spec.ts`
- Modify: `apps/desktop/src/renderer/src/stores/ipc-subscriptions.ts`
- Create: `apps/desktop/src/renderer/src/stores/ipc-subscriptions.spec.ts`
- Modify: `apps/desktop/src/renderer/src/components/tasks/TaskControlBar.tsx`
- Modify: `apps/desktop/src/renderer/src/components/tasks/TaskControlBar.spec.tsx`
- Modify: `apps/desktop/src/renderer/src/stores/chat-store.spec.ts`

**Interfaces:**
- Produces:
  - `statuses: Record<string, TaskStatus>`
  - `logsByTaskId: Record<string, string[]>`
  - `setStatus(id, status)` always updates only `statuses[id]`
  - `appendLog(id, line)` always updates only `logsByTaskId[id]`
  - `activeStatus(state)` / `activeLogs(state)` pure selectors
- Invariant: task A 的延迟 state/complete/failed/log event 可以更新 A 的历史投影，但绝不能改变 task B 的 active controls/chat stream。

- [ ] **Step 1: 写乱序事件失败测试**

`apps/desktop/src/renderer/src/stores/ipc-subscriptions.spec.ts`：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcEvent } from '@jarvis/protocol';
import { initIpcSubscriptions, resetIpcSubscriptionsForTests } from './ipc-subscriptions';
import { useTaskStore } from './task-store';
import { useChatStore } from './chat-store';

describe('task ipc subscriptions', () => {
  const handlers = new Map<string, (payload: unknown) => void>();

  beforeEach(() => {
    handlers.clear();
    resetIpcSubscriptionsForTests();
    (window as unknown as { jarvis: unknown }).jarvis = {
      invoke: vi.fn(),
      onDidReceive: (channel: string, cb: (payload: unknown) => void) => {
        handlers.set(channel, cb);
        return () => {};
      },
    };
    useTaskStore.setState({
      activeTaskId: 'task-b',
      statuses: { 'task-a': 'running', 'task-b': 'running' },
      logsByTaskId: { 'task-a': [], 'task-b': [] },
    });
    useChatStore.setState({ sessionId: 'session-b', streamingTaskSessionId: 'session-b' });
    initIpcSubscriptions();
  });

  it('keeps stale completion on its own task id', () => {
    handlers.get(IpcEvent.taskComplete)?.({ id: 'task-a', text: 'old result' });
    const state = useTaskStore.getState();
    expect(state.statuses['task-a']).toBe('completed');
    expect(state.statuses['task-b']).toBe('running');
    expect(useChatStore.getState().streaming).toBe(true);
  });

  it('keeps stale logs on their own task id', () => {
    handlers.get(IpcEvent.taskLog)?.({ id: 'task-a', line: 'old line' });
    expect(useTaskStore.getState().logsByTaskId).toEqual({
      'task-a': ['old line'],
      'task-b': [],
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/stores/ipc-subscriptions.spec.ts`

Expected: FAIL because the current store has one global `status/logs`.

- [ ] **Step 3: 实现 keyed store 与 selectors**

`task-store.ts` 的 state 改为：

```ts
import type { TaskStatus } from '@jarvis/protocol';

interface TaskState {
  activeTaskId: string | null;
  statuses: Record<string, TaskStatus>;
  logsByTaskId: Record<string, string[]>;
  createTask: (agentId: string, prompt: string, sessionId?: string) => Promise<string>;
  cancel: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  retry: () => Promise<void>;
  setStatus: (id: string, status: TaskStatus) => void;
  appendLog: (id: string, line: string) => void;
}

export const activeStatus = (state: TaskState): TaskStatus | null =>
  state.activeTaskId ? state.statuses[state.activeTaskId] ?? null : null;

export const activeLogs = (state: TaskState): string[] =>
  state.activeTaskId ? state.logsByTaskId[state.activeTaskId] ?? [] : [];

export const useTaskStore = create<TaskState>((set, get) => ({
  activeTaskId: null,
  statuses: {},
  logsByTaskId: {},
  async createTask(agentId, prompt, sessionId) {
    const { id } = await window.jarvis.invoke(
      IpcChannel.taskCreate,
      { agentId, prompt, sessionId },
    ) as { id: string };
    set((state) => ({
      activeTaskId: id,
      statuses: { ...state.statuses, [id]: 'queued' },
      logsByTaskId: { ...state.logsByTaskId, [id]: [] },
    }));
    return id;
  },
  async cancel() {
    const id = get().activeTaskId;
    if (id) await window.jarvis.invoke(IpcChannel.taskCancel, id);
  },
  async pause() {
    const id = get().activeTaskId;
    if (id) await window.jarvis.invoke(IpcChannel.taskPause, id);
  },
  async resume() {
    const id = get().activeTaskId;
    if (id) await window.jarvis.invoke(IpcChannel.taskResume, id);
  },
  async retry() {
    const id = get().activeTaskId;
    if (id) await window.jarvis.invoke(IpcChannel.taskRetry, id);
  },
  setStatus(id, status) {
    set((state) => ({ statuses: { ...state.statuses, [id]: status } }));
  },
  appendLog(id, line) {
    set((state) => ({
      logsByTaskId: {
        ...state.logsByTaskId,
        [id]: [...(state.logsByTaskId[id] ?? []), line],
      },
    }));
  },
}));
```

`ipc-subscriptions.ts` 的 task handlers 全部先 keyed update，再仅对 active id 操作 chat：

```ts
window.jarvis.onDidReceive(IpcEvent.taskLog, (payload) => {
  const { id, line } = payload as { id: string; line: string };
  useTaskStore.getState().appendLog(id, line);
  if (id !== useTaskStore.getState().activeTaskId) return;
  const chat = useChatStore.getState();
  if (chat.streamingTaskSessionId === chat.sessionId) chat.appendDelta(line);
});
```

complete/failed/state 同样保持 `setStatus(id, ...)`，随后比较 `id === activeTaskId` 再调用 `chat.finishStream`。`TaskControlBar.tsx` 改用：

```ts
const status = useTaskStore(activeStatus);
const logs = useTaskStore(activeLogs);
const cancel = useTaskStore((state) => state.cancel);
const pause = useTaskStore((state) => state.pause);
const resume = useTaskStore((state) => state.resume);
const retry = useTaskStore((state) => state.retry);
```

- [ ] **Step 4: 更新现有 specs 的初始 state**

所有旧的：

```ts
useTaskStore.setState({ activeTaskId: null, status: null, logs: [] });
```

精确替换为：

```ts
useTaskStore.setState({ activeTaskId: null, statuses: {}, logsByTaskId: {} });
```

组件测试设置运行态时使用：

```ts
useTaskStore.setState({
  activeTaskId: 't1',
  statuses: { t1: 'running' },
  logsByTaskId: { t1: [] },
});
```

- [ ] **Step 5: 运行 renderer store/component 测试**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/stores/task-store.spec.ts src/renderer/src/stores/ipc-subscriptions.spec.ts src/renderer/src/stores/chat-store.spec.ts src/renderer/src/components/tasks/TaskControlBar.spec.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/stores/task-store.ts apps/desktop/src/renderer/src/stores/task-store.spec.ts apps/desktop/src/renderer/src/stores/ipc-subscriptions.ts apps/desktop/src/renderer/src/stores/ipc-subscriptions.spec.ts apps/desktop/src/renderer/src/components/tasks/TaskControlBar.tsx apps/desktop/src/renderer/src/components/tasks/TaskControlBar.spec.tsx apps/desktop/src/renderer/src/stores/chat-store.spec.ts
git commit -m "fix: isolate renderer task state by task id"
```

---

### Task 4: Daemon transactional task store（MAINT-01）

**Files:**
- Create: `daemon/internal/taskstore/store.go`
- Create: `daemon/internal/taskstore/store_test.go`

**Interfaces:**
- Produces:
  - `Status = queued|running|paused|completed|failed|cancelled`
  - `CreateInput { ID; AgentID; Payload json.RawMessage }`
  - `TransitionInput { Event; Result; Error }`
  - `Store.Create(ctx, input) (Task, error)`
  - `Store.Get(ctx, id) (Task, error)`
  - `Store.Transition(ctx, id, input) (Task, error)`
  - `Store.Checkpoint(ctx, id, checkpoint json.RawMessage) error`
  - stable errors `ErrNotFound`, `ErrConflict`, `ErrInvalid`
- Every mutation begins `sql.Tx`; state is read and validated in the same transaction as update。
- Transition update is an optimistic compare-and-swap (`WHERE id=? AND status=?`); `RowsAffected()!=1` returns `ErrConflict`。A deferred transaction that only reads then updates without this predicate is not sufficient under concurrent terminal transitions。

- [ ] **Step 1: 写状态机/事务失败测试**

`daemon/internal/taskstore/store_test.go`：

```go
package taskstore

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	_ "modernc.org/sqlite"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	d, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	d.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = d.Close() })
	_, err = d.Exec(`CREATE TABLE tasks (
		id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, status TEXT NOT NULL,
		payload_json TEXT NOT NULL, result_json TEXT, error_json TEXT,
		multica_task_id TEXT, created_at TEXT NOT NULL,
		started_at TEXT, completed_at TEXT
	)`)
	if err != nil {
		t.Fatal(err)
	}
	return New(d)
}

func TestTransitionHappyPathAndTimestamps(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	if _, err := s.Create(ctx, CreateInput{ID: "t1", AgentID: "a1", Payload: []byte(`{"prompt":"go"}`)}); err != nil {
		t.Fatal(err)
	}
	running, err := s.Transition(ctx, "t1", TransitionInput{Event: EventStart})
	if err != nil {
		t.Fatal(err)
	}
	if running.Status != Running || running.StartedAt == nil {
		t.Fatalf("unexpected running task: %+v", running)
	}
	done, err := s.Transition(ctx, "t1", TransitionInput{Event: EventComplete, Result: []byte(`{"text":"ok"}`)})
	if err != nil {
		t.Fatal(err)
	}
	if done.Status != Completed || done.CompletedAt == nil || string(done.Result) != `{"text":"ok"}` {
		t.Fatalf("unexpected completed task: %+v", done)
	}
}

func TestTransitionRejectsStaleState(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	_, _ = s.Create(ctx, CreateInput{ID: "t1", AgentID: "a1", Payload: []byte(`{}`)})
	if _, err := s.Transition(ctx, "t1", TransitionInput{Event: EventComplete}); !errors.Is(err, ErrConflict) {
		t.Fatalf("want ErrConflict, got %v", err)
	}
	got, _ := s.Get(ctx, "t1")
	if got.Status != Queued {
		t.Fatalf("invalid transition changed row: %+v", got)
	}
}

func TestCheckpointMergesIntoRunningPayloadWithoutChangingStatus(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	_, _ = s.Create(ctx, CreateInput{ID: "t1", AgentID: "a1", Payload: []byte(`{"sessionId":"s1"}`)})
	_, _ = s.Transition(ctx, "t1", TransitionInput{Event: EventStart})
	if err := s.Checkpoint(ctx, "t1", []byte(`{"safePoint":"after-tool","nextStep":2}`)); err != nil {
		t.Fatal(err)
	}
	got, _ := s.Get(ctx, "t1")
	if string(got.Payload) != `{"checkpoint":{"nextStep":2,"safePoint":"after-tool"},"sessionId":"s1"}` {
		t.Fatalf("unexpected payload %s", got.Payload)
	}
	if got.Status != Running {
		t.Fatalf("checkpoint changed status: %s", got.Status)
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd daemon && go test ./internal/taskstore`

Expected: FAIL with package/files missing.

- [ ] **Step 3: 实现 transaction store**

`daemon/internal/taskstore/store.go`：

```go
package taskstore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

var (
	ErrNotFound = errors.New("task not found")
	ErrConflict = errors.New("task state conflict")
	ErrInvalid  = errors.New("invalid task request")
)

type Status string
const (
	Queued Status = "queued"; Running Status = "running"; Paused Status = "paused"
	Completed Status = "completed"; Failed Status = "failed"; Cancelled Status = "cancelled"
)

type Event string
const (
	EventStart Event = "start"; EventPause Event = "pause"; EventResume Event = "resume"
	EventCancel Event = "cancel"; EventComplete Event = "complete"; EventFail Event = "fail"
	EventRetry Event = "retry"; EventRollback Event = "rollback"
)

type Task struct {
	ID string `json:"id"`; AgentID string `json:"agentId"`; Status Status `json:"status"`
	Payload json.RawMessage `json:"payload"`; Result json.RawMessage `json:"result,omitempty"`
	Error json.RawMessage `json:"error,omitempty"`; CreatedAt string `json:"createdAt"`
	StartedAt *string `json:"startedAt,omitempty"`; CompletedAt *string `json:"completedAt,omitempty"`
}
type CreateInput struct { ID string; AgentID string; Payload json.RawMessage }
type TransitionInput struct { Event Event `json:"event"`; Result json.RawMessage `json:"result,omitempty"`; Error json.RawMessage `json:"error,omitempty"` }
type Store struct { db *sql.DB; now func() time.Time }
func New(db *sql.DB) *Store { return &Store{db: db, now: time.Now} }

var transitions = map[Status]map[Event]Status{
	Queued: {EventStart: Running, EventCancel: Cancelled},
	Running: {EventPause: Paused, EventCancel: Cancelled, EventComplete: Completed, EventFail: Failed},
	Paused: {EventResume: Running, EventCancel: Cancelled},
	Completed: {EventRetry: Queued, EventRollback: Failed},
	Failed: {EventRetry: Queued, EventCancel: Cancelled, EventRollback: Failed},
	Cancelled: {EventRetry: Queued},
}

func (s *Store) Create(ctx context.Context, in CreateInput) (Task, error) {
	if in.ID == "" || in.AgentID == "" || !json.Valid(in.Payload) { return Task{}, ErrInvalid }
	tx, err := s.db.BeginTx(ctx, nil); if err != nil { return Task{}, err }
	defer tx.Rollback()
	now := s.now().UTC().Format(time.RFC3339Nano)
	_, err = tx.ExecContext(ctx, `INSERT INTO tasks
		(id,agent_id,status,payload_json,created_at) VALUES (?,?,?,?,?)`,
		in.ID, in.AgentID, Queued, string(in.Payload), now)
	if err != nil { return Task{}, fmt.Errorf("create task: %w", err) }
	if err := tx.Commit(); err != nil { return Task{}, err }
	return s.Get(ctx, in.ID)
}

func (s *Store) Get(ctx context.Context, id string) (Task, error) {
	return scanTask(s.db.QueryRowContext(ctx, `SELECT id,agent_id,status,payload_json,
		result_json,error_json,created_at,started_at,completed_at FROM tasks WHERE id=?`, id))
}

func (s *Store) Transition(ctx context.Context, id string, in TransitionInput) (Task, error) {
	tx, err := s.db.BeginTx(ctx, nil); if err != nil { return Task{}, err }
	defer tx.Rollback()
	current, err := scanTask(tx.QueryRowContext(ctx, `SELECT id,agent_id,status,payload_json,
		result_json,error_json,created_at,started_at,completed_at FROM tasks WHERE id=?`, id))
	if err != nil { return Task{}, err }
	next, ok := transitions[current.Status][in.Event]
	if !ok { return Task{}, fmt.Errorf("%w: %s + %s", ErrConflict, current.Status, in.Event) }
	now := s.now().UTC().Format(time.RFC3339Nano)
	started := current.StartedAt
	completed := current.CompletedAt
	result := nullableJSON(current.Result); failure := nullableJSON(current.Error)
	if in.Event == EventStart && started == nil { started = &now }
	if in.Event == EventRetry { started = nil; result = nil; failure = nil }
	if next == Completed || next == Failed || next == Cancelled { completed = &now } else { completed = nil }
	if len(in.Result) > 0 { if !json.Valid(in.Result) { return Task{}, ErrInvalid }; result = string(in.Result) }
	if len(in.Error) > 0 { if !json.Valid(in.Error) { return Task{}, ErrInvalid }; failure = string(in.Error) }
	res, err := tx.ExecContext(ctx, `UPDATE tasks SET status=?,result_json=?,error_json=?,
		started_at=?,completed_at=? WHERE id=? AND status=?`,
		next, result, failure, started, completed, id, current.Status)
	if err != nil { return Task{}, err }
	affected, err := res.RowsAffected()
	if err != nil { return Task{}, err }
	if affected != 1 { return Task{}, ErrConflict }
	if err := tx.Commit(); err != nil { return Task{}, err }
	return s.Get(ctx, id)
}

func (s *Store) Checkpoint(ctx context.Context, id string, checkpoint json.RawMessage) error {
	if !json.Valid(checkpoint) { return ErrInvalid }
	tx, err := s.db.BeginTx(ctx, nil); if err != nil { return err }
	defer tx.Rollback()
	var raw string
	var status Status
	if err := tx.QueryRowContext(ctx, `SELECT payload_json,status FROM tasks WHERE id=?`, id).Scan(&raw, &status); err != nil {
		if errors.Is(err, sql.ErrNoRows) { return ErrNotFound }
		return err
	}
	if status != Running && status != Paused { return ErrConflict }
	var payload map[string]any
	var cp any
	if json.Unmarshal([]byte(raw), &payload) != nil || json.Unmarshal(checkpoint, &cp) != nil { return ErrInvalid }
	payload["checkpoint"] = cp
	merged, _ := json.Marshal(payload)
	res, err := tx.ExecContext(ctx, `UPDATE tasks SET payload_json=? WHERE id=? AND status=?`, string(merged), id, status)
	if err != nil { return err }
	affected, err := res.RowsAffected()
	if err != nil { return err }
	if affected != 1 { return ErrConflict }
	return tx.Commit()
}

type rowScanner interface { Scan(...any) error }
func scanTask(row rowScanner) (Task, error) {
	var t Task; var payload string; var result, failure, started, completed sql.NullString
	err := row.Scan(&t.ID,&t.AgentID,&t.Status,&payload,&result,&failure,&t.CreatedAt,&started,&completed)
	if errors.Is(err, sql.ErrNoRows) { return Task{}, ErrNotFound }
	if err != nil { return Task{}, err }
	t.Payload = json.RawMessage(payload)
	if result.Valid { t.Result = json.RawMessage(result.String) }
	if failure.Valid { t.Error = json.RawMessage(failure.String) }
	if started.Valid { t.StartedAt = &started.String }; if completed.Valid { t.CompletedAt = &completed.String }
	return t, nil
}
func nullableJSON(v json.RawMessage) any { if len(v) == 0 { return nil }; return string(v) }
```

- [ ] **Step 4: 运行测试与 race**

Run: `cd daemon && go test ./internal/taskstore && go test -race ./internal/taskstore`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add daemon/internal/taskstore/store.go daemon/internal/taskstore/store_test.go
git commit -m "feat: add transactional daemon task store"
```

---

### Task 5: 本地认证 daemon task API（MAINT-01）

**Files:**
- Create: `daemon/internal/httpapi/tasks.go`
- Create: `daemon/internal/httpapi/tasks_test.go`
- Modify: `daemon/internal/httpapi/server.go`
- Modify: `daemon/cmd/jarvis-daemon/main.go`

**Interfaces:**
- `POST /v1/tasks` → 201 `Task`
- `GET /v1/tasks/{id}` → 200 `Task`
- `POST /v1/tasks/{id}/transitions` → 200 `Task`
- `PUT /v1/tasks/{id}/checkpoint` → 204
- Stable error body: `{ "code": "TASK_NOT_FOUND|TASK_STATE_CONFLICT|TASK_INVALID|INTERNAL", "detail": string }`
- All four routes pass existing `authMiddleware`; `/health` remains the only unauthenticated endpoint。
- Every JSON route uses `http.MaxBytesReader` (1 MiB), `DisallowUnknownFields`, and rejects trailing JSON. `INTERNAL` detail is fixed and never returns SQL/path/token text。

- [ ] **Step 1: 写 API 认证与 transition 失败测试**

`daemon/internal/httpapi/tasks_test.go`：

```go
package httpapi

import (
	"bytes"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/taskstore"
	_ "modernc.org/sqlite"
)

func taskServer(t *testing.T) *Server {
	t.Helper()
	d, _ := sql.Open("sqlite", ":memory:")
	d.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = d.Close() })
	_, err := d.Exec(`CREATE TABLE tasks (
		id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, status TEXT NOT NULL,
		payload_json TEXT NOT NULL, result_json TEXT, error_json TEXT,
		multica_task_id TEXT, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT
	)`)
	if err != nil { t.Fatal(err) }
	return NewServerWithAuth("test", runtime.NewQueue(1, 1), "secret", taskstore.New(d))
}

func request(s *Server, method, path, body string, auth bool) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	if auth { req.Header.Set("Authorization", "Bearer secret") }
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	return rec
}

func TestTaskRoutesRequireAuth(t *testing.T) {
	rec := request(taskServer(t), http.MethodPost, "/v1/tasks", `{"id":"t1","agentId":"a1","payload":{}}`, false)
	if rec.Code != http.StatusUnauthorized { t.Fatalf("got %d", rec.Code) }
}

func TestTaskCreateAndTransition(t *testing.T) {
	s := taskServer(t)
	if got := request(s, http.MethodPost, "/v1/tasks", `{"id":"t1","agentId":"a1","payload":{"sessionId":"s1"}}`, true).Code; got != http.StatusCreated {
		t.Fatalf("create got %d", got)
	}
	if got := request(s, http.MethodPost, "/v1/tasks/t1/transitions", `{"event":"start"}`, true).Code; got != http.StatusOK {
		t.Fatalf("start got %d", got)
	}
	if got := request(s, http.MethodPost, "/v1/tasks/t1/transitions", `{"event":"complete","result":{"text":"ok"}}`, true).Code; got != http.StatusOK {
		t.Fatalf("complete got %d", got)
	}
}

func TestTaskTransitionConflictIs409(t *testing.T) {
	s := taskServer(t)
	request(s, http.MethodPost, "/v1/tasks", `{"id":"t1","agentId":"a1","payload":{}}`, true)
	rec := request(s, http.MethodPost, "/v1/tasks/t1/transitions", `{"event":"complete"}`, true)
	if rec.Code != http.StatusConflict || !bytes.Contains(rec.Body.Bytes(), []byte(`"TASK_STATE_CONFLICT"`)) {
		t.Fatalf("unexpected response %d %s", rec.Code, rec.Body.String())
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd daemon && go test ./internal/httpapi -run Task`

Expected: FAIL; task routes are not registered.

- [ ] **Step 3: 实现 routes**

`daemon/internal/httpapi/tasks.go`：

```go
package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/taskstore"
)

type createTaskRequest struct {
	ID string `json:"id"`; AgentID string `json:"agentId"`; Payload json.RawMessage `json:"payload"`
}

func (s *Server) taskRoutes() {
	s.mux.HandleFunc("POST /v1/tasks", func(w http.ResponseWriter, r *http.Request) {
		var req createTaskRequest
		if decodeJSON(w, r, &req) != nil { writeTaskError(w, taskstore.ErrInvalid); return }
		task, err := s.tasks.Create(r.Context(), taskstore.CreateInput{ID:req.ID, AgentID:req.AgentID, Payload:req.Payload})
		if err != nil { writeTaskError(w, err); return }
		w.WriteHeader(http.StatusCreated); writeJSON(w, task)
	})
	s.mux.HandleFunc("GET /v1/tasks/{id}", func(w http.ResponseWriter, r *http.Request) {
		task, err := s.tasks.Get(r.Context(), r.PathValue("id"))
		if err != nil { writeTaskError(w, err); return }
		writeJSON(w, task)
	})
	s.mux.HandleFunc("POST /v1/tasks/{id}/transitions", func(w http.ResponseWriter, r *http.Request) {
		var req taskstore.TransitionInput
		if decodeJSON(w, r, &req) != nil { writeTaskError(w, taskstore.ErrInvalid); return }
		task, err := s.tasks.Transition(r.Context(), r.PathValue("id"), req)
		if err != nil { writeTaskError(w, err); return }
		writeJSON(w, task)
	})
	s.mux.HandleFunc("PUT /v1/tasks/{id}/checkpoint", func(w http.ResponseWriter, r *http.Request) {
		var req struct { Checkpoint json.RawMessage `json:"checkpoint"` }
		if decodeJSON(w, r, &req) != nil { writeTaskError(w, taskstore.ErrInvalid); return }
		if err := s.tasks.Checkpoint(r.Context(), r.PathValue("id"), req.Checkpoint); err != nil {
			writeTaskError(w, err); return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

func writeTaskError(w http.ResponseWriter, err error) {
	status, code := http.StatusInternalServerError, "INTERNAL"
	detail := "internal task error"
	switch {
	case errors.Is(err, taskstore.ErrNotFound): status, code, detail = http.StatusNotFound, "TASK_NOT_FOUND", "task not found"
	case errors.Is(err, taskstore.ErrConflict): status, code, detail = http.StatusConflict, "TASK_STATE_CONFLICT", "task state conflict"
	case errors.Is(err, taskstore.ErrInvalid): status, code, detail = http.StatusBadRequest, "TASK_INVALID", "invalid task request"
	}
	w.WriteHeader(status)
	writeJSON(w, map[string]string{"code": code, "detail": detail})
}
```

上述 route 片段中的 `json.NewDecoder(r.Body)` 均替换为共享 `decodeJSON(w,r,&dst)` helper；该 helper 封装 1 MiB 上限、unknown-field/trailing-token 检查。实现后删除不再使用的 `strings` import。

在 `server.go` 增加 `tasks *taskstore.Store`；`NewServerWithAuth` extras switch 加 `case *taskstore.Store: s.tasks = v`，`routes()` 尾部在非 nil 时调用 `s.taskRoutes()`。

在 `main.go` 启动时只打开一次 DB 并注入：

```go
database, err := db.Open(defaultDBPath())
if err != nil { log.Fatal(err) }
defer database.Close()
tasks := taskstore.New(database)
extras := []httpapi.ServerExtra{st, tasks}
```

- [ ] **Step 4: 运行 HTTP、DB、race 测试**

Run: `cd daemon && go test ./internal/httpapi ./internal/taskstore && go test -race ./internal/httpapi ./internal/taskstore`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add daemon/internal/httpapi/tasks.go daemon/internal/httpapi/tasks_test.go daemon/internal/httpapi/server.go daemon/cmd/jarvis-daemon/main.go
git commit -m "feat: expose authenticated local daemon task API"
```

---

### Task 6: Main typed daemon client 与 tasks 单写者迁移（MAINT-01、PERF-01）

**Files:**
- Create: `apps/desktop/src/main/daemon/DaemonTaskClient.ts`
- Create: `apps/desktop/src/main/daemon/DaemonTaskClient.spec.ts`
- Modify: `apps/desktop/src/main/daemon/DaemonSupervisor.ts`
- Modify: `apps/desktop/src/main/ipc/tasks.ts`
- Modify: `apps/desktop/src/main/ipc/tasks.spec.ts`
- Modify: `apps/desktop/src/main/ipc/IpcRouter.ts`
- Modify: `apps/desktop/src/main/ipc/IpcRouter.spec.ts`

**Interfaces:**
- Produces `DaemonTaskClient`:
  - `create({id,agentId,payload}): Promise<DaemonTask>`
  - `get(id): Promise<DaemonTask>`
  - `transition(id,event,patch?): Promise<DaemonTask>`
  - `checkpoint(id,checkpoint): Promise<void>`
- `DaemonSupervisor.taskClient(): DaemonTaskClient`
- `registerTaskHandlers(..., deps: { daemonTasks: DaemonTaskClient; ... })`
- Main keeps read-only queries for resume/taskboard/artifacts, but `tasks.ts` contains zero `INSERT INTO tasks` / `UPDATE tasks` / `DELETE FROM tasks`。
- API failure is surfaced to IPC; no direct-SQL fallback。

- [ ] **Step 1: 写 typed client 失败测试**

`DaemonTaskClient.spec.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';
import { DaemonTaskClient } from './DaemonTaskClient';

describe('DaemonTaskClient', () => {
  it('authenticates and encodes task transitions', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 't1', agentId: 'a1', status: 'paused', payload: {} }),
      text: async () => '',
    }));
    const client = new DaemonTaskClient('http://127.0.0.1:17890', 'secret', fetchImpl);
    await client.transition('t1', 'pause');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:17890/v1/tasks/t1/transitions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
        body: JSON.stringify({ event: 'pause' }),
      }),
    );
  });

  it('throws stable daemon error codes without fallback', async () => {
    const client = new DaemonTaskClient('http://127.0.0.1:17890', 'secret', async () => ({
      ok: false,
      status: 409,
      json: async () => ({ code: 'TASK_STATE_CONFLICT', detail: 'queued + complete' }),
      text: async () => '',
    }));
    await expect(client.transition('t1', 'complete')).rejects.toMatchObject({
      code: 'TASK_STATE_CONFLICT',
      status: 409,
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/desktop && pnpm vitest run src/main/daemon/DaemonTaskClient.spec.ts`

Expected: FAIL; module missing.

- [ ] **Step 3: 实现 client**

`DaemonTaskClient.ts`：

```ts
import type { EngineCheckpoint, TaskTransitionEvent } from '@jarvis/core';
import type { TaskStatus } from '@jarvis/protocol';

export interface DaemonTask {
  id: string;
  agentId: string;
  status: TaskStatus;
  payload: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export class DaemonTaskError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) { super(message); }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<{
  ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string>;
}>;

export class DaemonTaskClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  create(input: { id: string; agentId: string; payload: Record<string, unknown> }) {
    return this.request<DaemonTask>('/v1/tasks', { method: 'POST', body: JSON.stringify(input) });
  }
  get(id: string) { return this.request<DaemonTask>(`/v1/tasks/${encodeURIComponent(id)}`); }
  transition(id: string, event: TaskTransitionEvent, patch: { result?: unknown; error?: unknown } = {}) {
    return this.request<DaemonTask>(`/v1/tasks/${encodeURIComponent(id)}/transitions`, {
      method: 'POST',
      body: JSON.stringify({ event, ...patch }),
    });
  }
  async checkpoint(id: string, checkpoint: EngineCheckpoint): Promise<void> {
    await this.request<void>(`/v1/tasks/${encodeURIComponent(id)}/checkpoint`, {
      method: 'PUT',
      body: JSON.stringify({ checkpoint }),
    });
  }
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
        ...init.headers,
      },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ code: 'DAEMON_HTTP_ERROR', detail: '' })) as { code?: string; detail?: string };
      throw new DaemonTaskError(body.code ?? 'DAEMON_HTTP_ERROR', response.status, body.detail ?? '');
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }
}
```

`DaemonSupervisor.taskClient()`：

```ts
taskClient(): DaemonTaskClient {
  return new DaemonTaskClient(`http://127.0.0.1:${this.port}`, this.token);
}
```

- [ ] **Step 4: 写 single-writer main 失败测试**

在 `tasks.spec.ts` 的 setup 注入 fake client：

```ts
const taskRows = new Map<string, DaemonTask>();
const daemonTasks = {
  async create(input: { id: string; agentId: string; payload: Record<string, unknown> }) {
    db.prepare('INSERT INTO tasks (id,agent_id,status,payload_json,created_at) VALUES (?,?,?,?,?)')
      .run(input.id, input.agentId, 'queued', JSON.stringify(input.payload), new Date().toISOString());
    return { ...input, status: 'queued' as const, createdAt: new Date().toISOString() };
  },
  async get(id: string) {
    const row = db.prepare('SELECT * FROM tasks WHERE id=?').get(id) as Record<string, unknown>;
    return { id, agentId: row.agent_id, status: row.status, payload: JSON.parse(row.payload_json as string) } as DaemonTask;
  },
  async transition(id: string, event: TaskTransitionEvent, patch = {}) {
    const next = ({ start:'running', pause:'paused', resume:'running', cancel:'cancelled', complete:'completed', fail:'failed', retry:'queued', rollback:'failed' } as const)[event];
    db.prepare('UPDATE tasks SET status=?,result_json=?,error_json=? WHERE id=?')
      .run(next, patch.result ? JSON.stringify(patch.result) : null, patch.error ? JSON.stringify(patch.error) : null, id);
    return this.get(id);
  },
  async checkpoint() {},
} as unknown as DaemonTaskClient;
```

新增断言：

```ts
it('uses daemon for every task mutation and never needs main SQL writes', async () => {
  const create = vi.spyOn(daemonTasks, 'create');
  const transition = vi.spyOn(daemonTasks, 'transition');
  const tasks = registerTaskHandlers(db, secrets, getWindow, createAgentStore(db), {
    chatFn: async () => ({ text: 'ok', usage: null }),
    daemonTasks,
  });
  const agentId = seedAgent();
  const { id } = await tasks.create(fakeEvent, { agentId, prompt: 'go' });
  await vi.waitFor(() => expect(transition).toHaveBeenCalledWith(id, 'complete', expect.anything()));
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ id, agentId }));
  expect(transition.mock.calls.map((call) => call[1])).toEqual(['start', 'complete']);
});
```

- [ ] **Step 5: 重构 tasks.ts 只通过 daemon 写**

精确删除 `taskLogs` module Map 和全部五处 task mutation SQL。Task store adapter 改为：

```ts
const store: TaskStoreAdapter = {
  create: async (id, agentId, payload = {}) => {
    await deps.daemonTasks.create({ id, agentId, payload });
  },
  transition: async (id, event, patch) => {
    const task = await deps.daemonTasks.transition(id, event, patch);
    return task.status;
  },
  checkpoint: (id, checkpoint) => deps.daemonTasks.checkpoint(id, checkpoint),
  async appendLog() {
    // Logs are streamed to renderer and not retained in an unbounded main Map.
  },
};
```

`create()` 在 engine submit 前：

```ts
await store.create(id, agentId, {
  prompt,
  ...(sessionId ? { sessionId } : {}),
});
```

`onDone` 不再写 `tasks`，只做 chat append、usage、artifact、notification。`resume` 只读 DB，paused resume 委托 orchestrator。`rollback` 完成文件恢复后调用：

```ts
await deps.daemonTasks.transition(id, 'rollback', {
  result: { reason: 'rolled_back' },
});
```

`IpcRouter.registerAll` 注入：

```ts
const tasks = registerTaskHandlers(
  this.db,
  secrets,
  () => BrowserWindow.getFocusedWindow(),
  createAgentStore(this.db),
  { settings, usageTracker, daemonTasks: daemon.taskClient() },
);
```

IpcRouter specs 的 daemon fake 增加：

```ts
taskClient: () => daemonTasks,
getRuntimeStatus: () => ({ registered:false, busy:false, activeTasks:0, lastHeartbeatAt:0, serverUrl:'', protocol:'acp', mode:'local' }),
getRuntimeConflicts: () => [],
```

- [ ] **Step 6: 静态确认 main 无 tasks 写入并运行测试**

Run: `rg "INSERT INTO tasks|UPDATE tasks|DELETE FROM tasks" apps/desktop/src/main --glob '*.ts'`

Expected: only migration/spec fixture matches; no production match under `ipc/tasks.ts`。

Run: `cd apps/desktop && pnpm vitest run src/main/daemon/DaemonTaskClient.spec.ts src/main/ipc/tasks.spec.ts src/main/ipc/IpcRouter.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/daemon/DaemonTaskClient.ts apps/desktop/src/main/daemon/DaemonTaskClient.spec.ts apps/desktop/src/main/daemon/DaemonSupervisor.ts apps/desktop/src/main/ipc/tasks.ts apps/desktop/src/main/ipc/tasks.spec.ts apps/desktop/src/main/ipc/IpcRouter.ts apps/desktop/src/main/ipc/IpcRouter.spec.ts
git commit -m "refactor: make daemon the sole tasks writer"
```

---

### Task 7: DaemonSupervisor generation 与有序 restart（MAINT-02）

**Files:**
- Modify: `apps/desktop/src/main/daemon/DaemonSupervisor.ts`
- Modify: `apps/desktop/src/main/daemon/DaemonSupervisor.spec.ts`
- Modify: `apps/desktop/src/main/ipc/IpcRouter.ts`
- Modify: `apps/desktop/src/main/index.ts`

**Interfaces:**
- `generation: number` increments before every spawn/stop。
- child `error/exit` handlers only mutate state when both generation and child identity match。
- `restart(): Promise<void>` waits for old child `exit` or 2s timeout before new spawn。
- `stop(): Promise<void>` stops pollers, kills child, waits exit/timeout, then clears current child。
- IPC `daemon.restart` awaits `daemon.restart()` and returns `{ok:true}`。

- [ ] **Step 1: 写旧 child 延迟 exit 失败测试**

扩展 `DaemonSupervisor` constructor 注入 `spawnImpl`、poller factories；在 spec 添加：

```ts
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

function fakeChild() {
  const emitter = new EventEmitter();
  const child = Object.assign(emitter, {
    killed: false,
    kill: vi.fn(() => {
      child.killed = true;
      return true;
    }),
  }) as unknown as ChildProcess;
  return {
    child,
    emit: (event: 'spawn' | 'exit' | 'error', value?: unknown) =>
      emitter.emit(event, value),
  };
}

it('ignores stale exit callbacks after a restart generation', async () => {
  const first = fakeChild();
  const second = fakeChild();
  const spawnImpl = vi.fn()
    .mockReturnValueOnce(first.child)
    .mockReturnValueOnce(second.child);
  const supervisor = new DaemonSupervisor('/daemon', { spawnImpl, stopTimeoutMs: 5 });
  const exits: number[] = [];

  supervisor.start(undefined, () => exits.push(1));
  const restart = supervisor.restart();
  first.emit('exit', 0);
  await restart;
  second.emit('spawn');
  expect(supervisor.currentGenerationForTests()).toBe(3);

  first.emit('exit', 0);
  expect(exits).toEqual([]);
  expect(supervisor.hasChildForTests()).toBe(true);
});

it('natural exit clears the current child so start can spawn again', () => {
  const first = fakeChild();
  const second = fakeChild();
  const spawnImpl = vi.fn().mockReturnValueOnce(first.child).mockReturnValueOnce(second.child);
  const supervisor = new DaemonSupervisor('/daemon', { spawnImpl });
  supervisor.start();
  first.emit('exit', 1);
  supervisor.start();
  expect(spawnImpl).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/desktop && pnpm vitest run src/main/daemon/DaemonSupervisor.spec.ts`

Expected: FAIL; constructor injection/test accessors and generation semantics missing.

- [ ] **Step 3: 实现 generation-guarded lifecycle**

关键实现：

```ts
private generation = 0;

start(onReady?: () => void, onExit?: () => void): void {
  if (this.child) return;
  const generation = ++this.generation;
  const child = this.deps.spawnImpl(this.binaryPath, [], {
    env: buildDaemonEnv(process.env, this.port, this.concurrencyProvider?.() ?? {}, this.token),
  });
  this.child = child;
  const isCurrent = () => this.generation === generation && this.child === child;
  child.once('error', () => {
    if (!isCurrent()) return;
    this.healthy = false;
    this.stopPollers();
    this.resetRuntimeCache();
    this.child = null;
  });
  child.once('exit', () => {
    if (!isCurrent()) return;
    this.healthy = false;
    this.stopPollers();
    this.resetRuntimeCache();
    this.child = null;
    onExit?.();
  });
  this.startPollers(generation, isCurrent, onReady);
}

async restart(): Promise<void> {
  await this.stop();
  this.start();
}

async stop(): Promise<void> {
  ++this.generation;
  this.healthy = false;
  this.stopPollers();
  this.resetRuntimeCache();
  const child = this.child;
  this.child = null;
  if (!child) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill();
  await Promise.race([
    exited,
    new Promise<void>((resolve) => setTimeout(resolve, this.deps.stopTimeoutMs ?? 2_000)),
  ]);
}
```

poller callbacks 都增加 `if (!isCurrent()) return`。`IpcRouter`：

```ts
this.register(IpcChannel.daemonRestart, async () => {
  await daemon.restart();
  return { ok: true };
});
```

`restart()` 必须保留首次 `start` 注册的 ready/exit callbacks，不能以无参 `start()` 丢失生产生命周期通知。`index.ts` 的 tray callback 使用 `void daemon.restart().catch(reportSanitizedError)`。应用退出使用一次性 `before-quit` gate：首次事件 `preventDefault()`，await `daemon.stop()` 后设置 `allowQuit=true` 并调用 `app.quit()`；不得用 `void daemon.stop()` 后立即退出。

- [ ] **Step 4: 运行 supervisor + IPC 测试**

Run: `cd apps/desktop && pnpm vitest run src/main/daemon/DaemonSupervisor.spec.ts src/main/ipc/IpcRouter.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/daemon/DaemonSupervisor.ts apps/desktop/src/main/daemon/DaemonSupervisor.spec.ts apps/desktop/src/main/ipc/IpcRouter.ts apps/desktop/src/main/index.ts
git commit -m "fix: isolate daemon child lifecycle by generation"
```

---

### Task 8: ApprovalCenter 统一 finalize timer/abort/dispose（MAINT-03、BP-01）

**Files:**
- Modify: `apps/desktop/src/main/approval/ApprovalCenter.ts`
- Create: `apps/desktop/src/main/approval/ApprovalCenter.spec.ts`
- Modify: `apps/desktop/src/main/ipc/task-engine-factory.ts`
- Modify: `apps/desktop/src/main/ipc/IpcRouter.ts`

**Interfaces:**
- pending record includes `timer`, `resolve`, optional `abortCleanup`。
- `finalize(id, ok)` is the only terminal path: resolve、`clearTimeout`、remove abort listener、delete Map。
- `request(req, signal?: AbortSignal)` rejects pause/cancel with `signal.reason`，不把 abort 记成用户 deny。
- `dispose()` finalizes all as false and leaves zero timers/pending。
- `pendingCountForTests()` returns size。

- [ ] **Step 1: 写 fake timer 失败测试**

`ApprovalCenter.spec.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { ApprovalCenter } from './ApprovalCenter';

describe('ApprovalCenter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('clears auto-deny timer on explicit resolution', async () => {
    const sent: Array<{ id: string }> = [];
    const win = { webContents: { send: (_channel: string, payload: unknown) => {
      if ((payload as { id?: string }).id) sent.push(payload as { id: string });
    } } } as unknown as BrowserWindow;
    const center = new ApprovalCenter(() => win);
    const result = center.request({ toolName: 'git_commit', args: {}, prompt: 'run' });
    center.resolve(sent.at(-1)!.id, true);
    await expect(result).resolves.toBe(true);
    expect(center.pendingCountForTests()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears timer and rejects when pause aborts approval', async () => {
    const win = { webContents: { send: vi.fn() } } as unknown as BrowserWindow;
    const center = new ApprovalCenter(() => win);
    const controller = new AbortController();
    const result = center.request({ toolName: 'run_shell', args: {}, prompt: 'run' }, controller.signal);
    controller.abort(new DOMException('paused', 'AbortError'));
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(center.pendingCountForTests()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/desktop && pnpm vitest run src/main/approval/ApprovalCenter.spec.ts`

Expected: FAIL; resolved timers remain and request has no signal.

- [ ] **Step 3: 实现统一 finalize**

`ApprovalCenter.ts` 核心：

```ts
interface PendingRecord extends PendingApproval {
  resolve: (ok: boolean) => void;
  reject: (reason: unknown) => void;
  timer: NodeJS.Timeout;
  abortCleanup?: () => void;
}

private pending = new Map<string, PendingRecord>();

request(req: Omit<PendingApproval, 'id'>, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  const win = this.getWindow();
  if (!win) return Promise.resolve(false);
  const id = randomUUID();
  return new Promise<boolean>((resolve, reject) => {
    const timer = setTimeout(() => this.finalize(id, { kind: 'resolve', ok: false }), ApprovalCenter.AUTO_DENY_MS);
    timer.unref?.();
    const record: PendingRecord = { ...req, id, resolve, reject, timer };
    if (signal) {
      const onAbort = () => this.finalize(id, { kind: 'reject', reason: signal.reason });
      signal.addEventListener('abort', onAbort, { once: true });
      record.abortCleanup = () => signal.removeEventListener('abort', onAbort);
    }
    this.pending.set(id, record);
    win.webContents.send(IpcEvent.taskLog, { id: 'approval', line: `approval: ${req.toolName}` });
    win.webContents.send(IpcEvent.approvalRequest, { id, ...req });
  });
}

resolve(id: string, ok: boolean): void {
  this.finalize(id, { kind: 'resolve', ok });
}

dispose(): void {
  for (const id of [...this.pending.keys()]) this.finalize(id, { kind: 'resolve', ok: false });
}

private finalize(
  id: string,
  outcome: { kind: 'resolve'; ok: boolean } | { kind: 'reject'; reason: unknown },
): void {
  const record = this.pending.get(id);
  if (!record) return;
  this.pending.delete(id);
  clearTimeout(record.timer);
  record.abortCleanup?.();
  if (outcome.kind === 'resolve') record.resolve(outcome.ok);
  else record.reject(outcome.reason);
}

pendingCountForTests(): number { return this.pending.size; }
```

`task-engine-factory.ts`：

```ts
const ok = await approval.request(req, req.signal);
```

`IpcRouter.registerAll` 把 `tasks.approvalCenter.dispose()` push 到 `disposeFns`。

- [ ] **Step 4: 运行审批与 task wiring 测试**

Run: `cd apps/desktop && pnpm vitest run src/main/approval/ApprovalCenter.spec.ts src/main/ipc/tasks.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/approval/ApprovalCenter.ts apps/desktop/src/main/approval/ApprovalCenter.spec.ts apps/desktop/src/main/ipc/task-engine-factory.ts apps/desktop/src/main/ipc/IpcRouter.ts
git commit -m "fix: finalize approval timers on every terminal path"
```

---

### Task 9: Busy active count 与 registration locking（MAINT-04、MAINT-06）

**Files:**
- Modify: `daemon/cmd/jarvis-daemon/main.go`
- Modify: `daemon/cmd/jarvis-daemon/main_test.go`
- Modify: `daemon/internal/multica/client/client.go`
- Modify: `daemon/internal/multica/client/client_test.go`

**Interfaces:**
- `runtimeState.Busy()` returns `q.Status().ActiveTasks > 0`; remove mutable `busy bool`。
- `agentExec` no longer sets/clears busy。
- `serveOnce` reads registration only through `RegisteredID()`。
- `setRegistration`/`registrationSnapshot` use `sync.RWMutex`; no direct field reads outside those methods。

- [ ] **Step 1: 写两个错峰任务 busy 失败测试**

追加 `main_test.go`：

```go
func waitFor(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if condition() { return }
		time.Sleep(time.Millisecond)
	}
	t.Fatal("condition was not met before deadline")
}

func TestBusyStaysTrueUntilAllConcurrentTasksFinish(t *testing.T) {
	q := runtime.NewQueue(2, 2)
	st := &runtimeState{q: q}
	first := make(chan struct{})
	second := make(chan struct{})
	done := make(chan struct{}, 2)
	q.Submit("a", func() { <-first; done <- struct{}{} })
	q.Submit("b", func() { <-second; done <- struct{}{} })
	waitFor(t, func() bool { return st.ActiveTasks() == 2 })
	if !st.Busy() { t.Fatal("expected busy with two active tasks") }
	close(first); <-done
	waitFor(t, func() bool { return st.ActiveTasks() == 1 })
	if !st.Busy() { t.Fatal("first completion cleared busy while second task runs") }
	close(second); <-done
	waitFor(t, func() bool { return st.ActiveTasks() == 0 })
	if st.Busy() { t.Fatal("expected idle after all tasks finish") }
}
```

追加 `client_test.go`：

```go
type rotatingAPI struct {
	sequence atomic.Int64
	emptyID atomic.Bool
	failHeartbeat atomic.Bool
}

func (r *rotatingAPI) Register(context.Context, RegisterRequest) (RegisterResponse, error) {
	id := r.sequence.Add(1)
	return RegisterResponse{ClientID: fmt.Sprintf("client-%d", id)}, nil
}
func (r *rotatingAPI) Heartbeat(_ context.Context, id string, _ HeartbeatStatus) error {
	if id == "" { r.emptyID.Store(true) }
	if r.failHeartbeat.CompareAndSwap(false, true) { return errors.New("force re-register") }
	return nil
}
func (r *rotatingAPI) Poll(_ context.Context, id string) ([]ClaimedTask, error) {
	if id == "" { r.emptyID.Store(true) }
	return nil, nil
}
func (*rotatingAPI) StreamProgress(context.Context, string, string, runtime.StreamChunk) error { return nil }
func (*rotatingAPI) SendResult(context.Context, string, string, TaskResult) error { return nil }
func (*rotatingAPI) Ack(context.Context, string, string, bool) error { return nil }

func TestServeRegistrationReadsAreRaceFree(t *testing.T) {
	api := &rotatingAPI{}
	c := NewClient(api, ClientOptions{
		HeartbeatSec: time.Millisecond,
		PollSec: time.Millisecond,
		ReconnectSec: time.Millisecond,
	})
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Millisecond)
	defer cancel()
	var readers sync.WaitGroup
	for i := 0; i < 8; i++ {
		readers.Add(1)
		go func() {
			defer readers.Done()
			for ctx.Err() == nil { _ = c.RegisteredID() }
		}()
	}
	_ = c.Serve(ctx, func() HeartbeatStatus { return HeartbeatStatus{Status:"idle"} }, nil)
	readers.Wait()
	if api.emptyID.Load() { t.Fatal("serve sent an empty registration id") }
}
```

该测试文件 imports 增加 `fmt` 与 `sync/atomic`；已有 `errors`、`context`、`runtime` imports 继续复用。

- [ ] **Step 2: 运行 race 确认失败**

Run: `cd daemon && go test -race ./cmd/jarvis-daemon ./internal/multica/client`

Expected: FAIL/race at `serveOnce` direct `c.registration.ClientID`, busy test exposes mutable boolean semantics.

- [ ] **Step 3: 移除 busy boolean 并统一 registration accessor**

`runtimeState`：

```go
type runtimeState struct {
	mu sync.RWMutex
	q *runtime.Queue
	registered bool
	heartbeat int64
	serverURL string
}
func (s *runtimeState) Busy() bool { return s.q.Status().ActiveTasks > 0 }
```

删除 `agentExec` 开头/`defer` 对 `st.busy` 的写入。

`Client`：

```go
mu sync.RWMutex

func (c *Client) setRegistration(reg RegisterResponse) {
	c.mu.Lock(); defer c.mu.Unlock()
	c.registration = reg
}
func (c *Client) registrationSnapshot() RegisterResponse {
	c.mu.RLock(); defer c.mu.RUnlock()
	return c.registration
}
func (c *Client) RegisteredID() string {
	return c.registrationSnapshot().ClientID
}
```

`Register` 调 `setRegistration(res)`；`serveOnce`：

```go
case <-hb.C:
  if err := c.api.Heartbeat(ctx, c.RegisteredID(), status()); err != nil { return err }
case <-poll.C:
  tasks, err := c.api.Poll(ctx, c.RegisteredID())
```

- [ ] **Step 4: 运行 race 测试**

Run: `cd daemon && go test -race ./cmd/jarvis-daemon ./internal/multica/client ./internal/runtime`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add daemon/cmd/jarvis-daemon/main.go daemon/cmd/jarvis-daemon/main_test.go daemon/internal/multica/client/client.go daemon/internal/multica/client/client_test.go
git commit -m "fix: derive daemon busy state and lock registration reads"
```

---

### Task 10: 真实 local injection snapshot 与生产接线（MAINT-05）

**Files:**
- Create: `daemon/internal/runtime/injection_store.go`
- Create: `daemon/internal/runtime/injection_store_test.go`
- Modify: `daemon/internal/httpapi/server.go`
- Create: `daemon/internal/httpapi/injection_test.go`
- Modify: `daemon/cmd/jarvis-daemon/main.go`
- Modify: `daemon/cmd/jarvis-daemon/main_test.go`
- Create: `apps/desktop/src/main/daemon/local-injection.ts`
- Create: `apps/desktop/src/main/daemon/local-injection.spec.ts`
- Modify: `apps/desktop/src/main/daemon/DaemonSupervisor.ts`
- Modify: `apps/desktop/src/main/index.ts`

**Interfaces:**
- JSON contract:

```ts
interface LocalInjectionSnapshot {
  default: { skills: SkillSpec[] };
  agents: Record<string, {
    mcpServers: MCPEntry[];
    skills: SkillSpec[];
    env: Record<string, string>;
    cliArgs: string[];
  }>;
}
```

- `PUT /v1/runtime/local-injection` authenticated, validates and atomically replaces in-memory snapshot。
- Go `InjectionStore.ForAgent(ctx, agentID) (acp.Injection, error)` returns a deep copy: default skills + agent-specific MCP/env/CLI。
- main `buildLocalInjectionSnapshot(db)` reads:
  - all `skills(name,path)` into default skills；
  - each `agents(id,env_vars_json,cli_args_json)`；
  - stdio `mcp_servers.config_json.agentIds` bindings；
  - malformed JSON causes a typed error, never silently emits an empty production snapshot。
- Supervisor calls sync after daemon ready and after restart；failure marks daemon unhealthy and is logged without secrets。
- `agentExec` receives the same interface used by the security plan:
  `InjectionSource.ForAgent(context.Context, string) (acp.Injection, error)`；production no longer passes `acp.Injection{}`。

- [ ] **Step 1: 写 snapshot builder 失败测试**

`apps/desktop/src/main/daemon/local-injection.spec.ts`：

```ts
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../db/migrations';
import { buildLocalInjectionSnapshot } from './local-injection';

it('builds per-agent MCP/env/CLI plus real local skills', () => {
  const db = new Database(':memory:');
  applyMigrations(db);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO agents
    (id,name,slug,description,system_prompt,model_id,workspace_id,context_budget_tokens,
     plan_only,env_vars_json,cli_args_json,created_at,updated_at)
    VALUES ('a1','A','a','','',NULL,NULL,1000,0,?, ?, ?, ?)`)
    .run(JSON.stringify({ LOCAL_ENV: '1' }), JSON.stringify(['--local']), now, now);
  db.prepare('INSERT INTO skills (id,name,path,description,created_at) VALUES (?,?,?,?,?)')
    .run('s1', 'review', '/skills/review/SKILL.md', '', now);
  db.prepare('INSERT INTO mcp_servers (id,name,transport,config_json,created_at) VALUES (?,?,?,?,?)')
    .run('m1', 'fs', 'stdio', JSON.stringify({ command:'/bin/fs-mcp', args:['--safe'], agentIds:['a1'] }), now);

  expect(buildLocalInjectionSnapshot(db)).toEqual({
    default: { skills: [{ source:'local', name:'review', path:'/skills/review/SKILL.md' }] },
    agents: {
      a1: {
        mcpServers: [{ name:'fs', command:'/bin/fs-mcp', args:['--safe'] }],
        skills: [],
        env: { LOCAL_ENV:'1' },
        cliArgs: ['--local'],
      },
    },
  });
});
```

- [ ] **Step 2: 写 Go store/API/production conflict 失败测试**

`injection_store_test.go`：

```go
func TestInjectionStoreReturnsPerAgentDeepCopy(t *testing.T) {
	store := NewInjectionStore()
	store.Replace(LocalInjectionSnapshot{
		Default: acp.Injection{Skills: []acp.SkillSpec{{Source:"local",Name:"review",Path:"/skills/review"}}},
		Agents: map[string]acp.Injection{"a1": {Env: map[string]string{"LOCAL":"1"}}},
	})
	got, err := store.ForAgent(context.Background(), "a1")
	if err != nil { t.Fatal(err) }
	got.Env["LOCAL"] = "changed"
	again, err := store.ForAgent(context.Background(), "a1")
	if err != nil { t.Fatal(err) }
	if again.Env["LOCAL"] != "1" { t.Fatal("snapshot leaked mutable map") }
	if len(got.Skills) != 1 { t.Fatalf("default skills missing: %+v", got) }
}
```

`main_test.go`：

```go
func TestProductionInjectionSourceProducesConflict(t *testing.T) {
	source := runtime.NewInjectionStore()
	source.Replace(runtime.LocalInjectionSnapshot{
		Default: acp.Injection{Skills: []acp.SkillSpec{{Source:"local",Name:"review",Path:"/local/review"}}},
	})
	cs := client.NewConflictStore()
	exec := agentExec(&fakeInvoker{}, &runtimeState{q:runtime.NewQueue(1,1)}, runtime.NewWorkspacePoolFS("/ws",&memPoolFS{}), &memSkillFS{}, cs, source)
	_, err := exec(context.Background(), &acp.TaskPayload{TaskID:"t1",Instruction:"x",Skills:[]string{"review"}}, nil)
	if err != nil { t.Fatal(err) }
	if len(cs.Conflicts()) != 1 { t.Fatalf("real local snapshot did not produce conflict: %+v", cs.Conflicts()) }
}
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd apps/desktop && pnpm vitest run src/main/daemon/local-injection.spec.ts`

Expected: FAIL; builder missing.

Run: `cd daemon && go test ./internal/runtime ./internal/httpapi ./cmd/jarvis-daemon -run Injection`

Expected: FAIL; store/API/source missing.

- [ ] **Step 4: 实现 Go InjectionStore 与 authenticated PUT**

`injection_store.go`：

```go
package runtime

import (
	"context"
	"sync"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/acp"
)

type LocalInjectionSnapshot struct {
	Default acp.Injection `json:"default"`
	Agents map[string]acp.Injection `json:"agents"`
}
type InjectionStore struct { mu sync.RWMutex; snapshot LocalInjectionSnapshot }
func NewInjectionStore() *InjectionStore {
	return &InjectionStore{snapshot: LocalInjectionSnapshot{Agents: map[string]acp.Injection{}}}
}
func (s *InjectionStore) Replace(snapshot LocalInjectionSnapshot) {
	s.mu.Lock(); defer s.mu.Unlock(); s.snapshot = cloneSnapshot(snapshot)
}
func (s *InjectionStore) ForAgent(_ context.Context, id string) (acp.Injection, error) {
	s.mu.RLock(); defer s.mu.RUnlock()
	base := cloneInjection(s.snapshot.Default)
	agent := cloneInjection(s.snapshot.Agents[id])
	base.MCPServers = append(base.MCPServers, agent.MCPServers...)
	base.Skills = append(base.Skills, agent.Skills...)
	for k,v := range agent.Env { if base.Env == nil { base.Env=map[string]string{} }; base.Env[k]=v }
	base.CLIArgs = append(base.CLIArgs, agent.CLIArgs...)
	return base, nil
}
```

`Server` extras switch 接受 `*runtime.InjectionStore` 并注册：

```go
s.mux.HandleFunc("PUT /v1/runtime/local-injection", func(w http.ResponseWriter, r *http.Request) {
	var snapshot runtime.LocalInjectionSnapshot
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&snapshot); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		writeJSON(w, map[string]string{"code":"INJECTION_INVALID","detail":err.Error()})
		return
	}
	s.injections.Replace(snapshot)
	w.WriteHeader(http.StatusNoContent)
})
```

`agentExec` 签名最后一参改为：

```go
type injectionSource interface {
	ForAgent(context.Context, string) (acp.Injection, error)
}
```

执行时：

```go
local, err := source.ForAgent(ctx, p.Agent)
if err != nil { return nil, err }
merged, sc, mc, err := client.ApplyInjection(ctx, p, local, ws, skillFS)
```

生产 wiring 创建 `injections := runtime.NewInjectionStore()`，同时传入 http extras 与 `agentExec`。

- [ ] **Step 5: 实现 main snapshot builder 与 supervisor sync**

`local-injection.ts` 完整实现：

```ts
import type Database from 'better-sqlite3';

export function buildLocalInjectionSnapshot(db: Database.Database) {
  const skills = (db.prepare('SELECT name,path FROM skills ORDER BY name').all() as Array<{name:string;path:string}>)
    .map((skill) => ({ source:'local' as const, name:skill.name, path:skill.path }));
  const agents = db.prepare('SELECT id,env_vars_json,cli_args_json FROM agents ORDER BY id').all() as Array<{
    id:string; env_vars_json:string; cli_args_json:string;
  }>;
  const result: Record<string, {
    mcpServers: Array<{name:string;command:string;args:string[]}>;
    skills: typeof skills; env:Record<string,string>; cliArgs:string[];
  }> = {};
  for (const agent of agents) {
    result[agent.id] = {
      mcpServers: [],
      skills: [],
      env: JSON.parse(agent.env_vars_json || '{}') as Record<string,string>,
      cliArgs: JSON.parse(agent.cli_args_json || '[]') as string[],
    };
  }
  const servers = db.prepare(`SELECT name,transport,config_json FROM mcp_servers ORDER BY name`).all() as Array<{
    name:string; transport:string; config_json:string;
  }>;
  for (const server of servers) {
    if (server.transport !== 'stdio') continue;
    const cfg = JSON.parse(server.config_json || '{}') as { command?:string; args?:string[]; agentIds?:string[] };
    if (!cfg.command) continue;
    for (const agentId of cfg.agentIds ?? []) {
      result[agentId]?.mcpServers.push({ name:server.name, command:cfg.command, args:cfg.args ?? [] });
    }
  }
  return { default: { skills }, agents: result };
}
```

`DaemonSupervisor` 增加：

```ts
private injectionProvider: (() => unknown) | null = null;
setLocalInjectionProvider(provider: () => unknown): void { this.injectionProvider = provider; }
private async syncLocalInjection(): Promise<void> {
  const snapshot = this.injectionProvider?.();
  if (!snapshot) return;
  const response = await fetch(`http://127.0.0.1:${this.port}/v1/runtime/local-injection`, {
    method: 'PUT',
    headers: { 'Content-Type':'application/json', ...daemonAuthHeaders(this.token) },
    body: JSON.stringify(snapshot),
  });
  if (!response.ok) throw new Error(`local injection sync failed: ${response.status}`);
}
```

health ready callback 在设置 healthy/onReady 前 `await syncLocalInjection()`；失败保持 `healthy=false`。`index.ts`：

```ts
daemon.setLocalInjectionProvider(() => buildLocalInjectionSnapshot(db));
```

- [ ] **Step 6: 运行 TS/Go 目标测试与 race**

Run: `cd apps/desktop && pnpm vitest run src/main/daemon/local-injection.spec.ts src/main/daemon/DaemonSupervisor.spec.ts`

Expected: PASS.

Run: `cd daemon && go test -race ./internal/runtime ./internal/httpapi ./cmd/jarvis-daemon`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add daemon/internal/runtime/injection_store.go daemon/internal/runtime/injection_store_test.go daemon/internal/httpapi/server.go daemon/internal/httpapi/injection_test.go daemon/cmd/jarvis-daemon/main.go daemon/cmd/jarvis-daemon/main_test.go apps/desktop/src/main/daemon/local-injection.ts apps/desktop/src/main/daemon/local-injection.spec.ts apps/desktop/src/main/daemon/DaemonSupervisor.ts apps/desktop/src/main/index.ts
git commit -m "fix: wire real local injection snapshots into daemon"
```

---

### Task 11: 全链路生命周期回归与静态单写者门禁

**Files:**
- Create: `apps/desktop/src/main/ipc/task-daemon-lifecycle.spec.ts`
- Modify: `daemon/internal/httpapi/tasks_test.go`
- Modify: `package.json`

**Interfaces:**
- `pnpm test:task-lifecycle` runs focused TS + Go suites。
- Integration proves:
  1. main creates daemon-owned queued row；
  2. TS engine runs in main；
  3. pause IPC resolves only after safe-point and row is paused；
  4. no model/tool call while paused；
  5. resume completes without duplicate tool side effect；
  6. daemon transaction owns every transition；
  7. terminal orchestrator resource maps are reclaimed。

- [ ] **Step 1: 写 main↔daemon contract integration test**

`task-daemon-lifecycle.spec.ts` 使用 `httptest` 等价的本地 Node HTTP fake 不足以验证 Go transaction，因此该 spec 启动已构建的 test daemon，使用临时 `HOME`、随机端口和 token：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { DaemonTaskClient } from '../daemon/DaemonTaskClient';
import { applyMigrations } from '../db/migrations';

describe.runIf(process.env.JARVIS_TEST_DAEMON_BIN)('task daemon lifecycle', () => {
  let child: ChildProcess | null = null;
  let home = '';
  afterEach(() => {
    child?.kill();
    if (home) rmSync(home, { recursive:true, force:true });
  });

  it('persists the main TS engine lifecycle through daemon-only transitions', async () => {
    home = mkdtempSync(join(tmpdir(), 'jarvis-task-daemon-'));
    const port = 19000 + Math.floor(Math.random() * 1000);
    mkdirSync(join(home, '.jarvis'), { recursive: true });
    const setupDb = new Database(join(home, '.jarvis', 'jarvis.db'));
    applyMigrations(setupDb);
    setupDb.close();
    child = spawn(process.env.JARVIS_TEST_DAEMON_BIN!, [], {
      env: { ...process.env, HOME:home, JARVIS_DAEMON_PORT:String(port), JARVIS_DAEMON_TOKEN:'test-token' },
      stdio:'pipe',
    });
    await vi.waitFor(async () => {
      expect((await fetch(`http://127.0.0.1:${port}/health`)).ok).toBe(true);
    }, { timeout:5_000 });

    const client = new DaemonTaskClient(`http://127.0.0.1:${port}`, 'test-token');
    await client.create({ id:'t1', agentId:'a1', payload:{ prompt:'go' } });
    await client.transition('t1', 'start');
    await client.checkpoint('t1', {
      safePoint:'after-tool', messages:[], nextStep:1, toolCalls:1, finalText:'', usage:null,
    });
    await client.transition('t1', 'pause');
    expect((await client.get('t1')).status).toBe('paused');
    await client.transition('t1', 'resume');
    await client.transition('t1', 'complete', { result:{ text:'ok' } });

    const db = new Database(join(home, '.jarvis', 'jarvis.db'), { readonly:true });
    const row = db.prepare('SELECT status,result_json,payload_json FROM tasks WHERE id=?').get('t1') as {
      status:string; result_json:string; payload_json:string;
    };
    expect(row.status).toBe('completed');
    expect(JSON.parse(row.result_json)).toEqual({ text:'ok' });
    expect(JSON.parse(row.payload_json).checkpoint.safePoint).toBe('after-tool');
    db.close();
  });
});
```

- [ ] **Step 2: 添加 API 并发 CAS 回归**

在 Go `tasks_test.go` 添加两个 goroutine 同时对 running task complete/fail；断言恰好一个 200、一个 409，最终状态只对应胜者，证明 read+validate+write 位于 transaction。

```go
func TestConcurrentTerminalTransitionsHaveSingleWinner(t *testing.T) {
	s := taskServer(t)
	request(s,http.MethodPost,"/v1/tasks",`{"id":"t1","agentId":"a1","payload":{}}`,true)
	request(s,http.MethodPost,"/v1/tasks/t1/transitions",`{"event":"start"}`,true)
	codes := make(chan int,2)
	go func(){ codes <- request(s,http.MethodPost,"/v1/tasks/t1/transitions",`{"event":"complete","result":{"text":"ok"}}`,true).Code }()
	go func(){ codes <- request(s,http.MethodPost,"/v1/tasks/t1/transitions",`{"event":"fail","error":{"message":"boom"}}`,true).Code }()
	a,b := <-codes,<-codes
	if !((a==http.StatusOK && b==http.StatusConflict)||(b==http.StatusOK && a==http.StatusConflict)) {
		t.Fatalf("expected 200/409, got %d/%d",a,b)
	}
}
```

- [ ] **Step 3: 添加 focused script**

根 `package.json` scripts 精确增加：

```json
"test:task-lifecycle": "pnpm --dir packages/core vitest run src/task/CooperativeRunControl.spec.ts src/task/TaskOrchestrator.spec.ts src/agent/AgentEngine.spec.ts && pnpm --dir apps/desktop vitest run src/main/daemon/DaemonTaskClient.spec.ts src/main/daemon/DaemonSupervisor.spec.ts src/main/approval/ApprovalCenter.spec.ts src/main/ipc/tasks.spec.ts src/main/ipc/task-daemon-lifecycle.spec.ts src/renderer/src/stores/task-store.spec.ts src/renderer/src/stores/ipc-subscriptions.spec.ts && cd daemon && go test -race ./internal/taskstore ./internal/httpapi ./internal/runtime ./internal/multica/client ./cmd/jarvis-daemon"
```

- [ ] **Step 4: 构建 daemon 并运行 focused integration**

Run:

```bash
cd daemon
go build -o /tmp/jarvis-daemon-task-lifecycle ./cmd/jarvis-daemon
cd ..
JARVIS_TEST_DAEMON_BIN=/tmp/jarvis-daemon-task-lifecycle pnpm test:task-lifecycle
```

Expected: PASS；integration spec 不 skip。

- [ ] **Step 5: 运行静态 owner 检查**

Run:

```bash
rg "INSERT INTO tasks|UPDATE tasks|DELETE FROM tasks" apps/desktop/src/main --glob '*.ts' --glob '!**/*.spec.ts' --glob '!**/migrations.ts'
```

Expected: no output, exit 1（无 production main task write）。

Run:

```bash
rg "registration\\.ClientID|\\.busy\\s*=" daemon --glob '*.go'
```

Expected: no production matches。

- [ ] **Step 6: 运行跨仓验证**

Run: `pnpm typecheck`

Expected: PASS.

Run: `pnpm test`

Expected: PASS.

Run: `cd daemon && go test ./... && go test -race ./...`

Expected: PASS.

Run: `pnpm i18n:check`

Expected: PASS（本计划未新增 UI copy，仍验证键对称）。

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/ipc/task-daemon-lifecycle.spec.ts daemon/internal/httpapi/tasks_test.go package.json
git commit -m "test: cover task daemon lifecycle end to end"
```

---

## Self-Review

### CR coverage

- BP-01：Task 1 safe points/AbortSignal/checkpoint；Task 2 pause acknowledgement；Task 8 approval abort；Task 11 full lifecycle。
- BP-07：Task 3 keyed renderer projections and stale-event tests。
- PERF-01：Task 2 terminal Map cleanup、128-entry retry cache、10k task test；Task 6 removes main task log Map。
- MAINT-01：Task 4 transactional store、Task 5 authenticated API、Task 6 zero main writes、Task 11 static gate。
- MAINT-02：Task 7 generation + ordered restart。
- MAINT-03：Task 8 unified finalize。
- MAINT-04：Task 9 queue-derived busy。
- MAINT-05：Task 10 real local snapshot and production source。
- MAINT-06：Task 9 RWMutex accessors + race test。

### Type and ownership consistency

- `TaskTransitionEvent` is defined once in core and consumed by `DaemonTaskClient`。
- `EngineCheckpoint` is defined once in core；daemon treats it as validated JSON and never receives API keys。
- Local execution remains `createTaskEngineRuntime → AgentEngine.run` in Electron main。
- `tasks` mutations occur only in `daemon/internal/taskstore`; main uses daemon client and read-only SQLite queries。
- `paused` is persisted only after `CooperativeRunControl.pause()` returns a safe-point checkpoint。
- terminal task resources are removed even on cancel/start races and failures；retry data is bounded and can rebuild through `RetryInputSource`。

### Completeness scan

所有测试 helper、跨层类型、失败命令、通过命令和提交文件均在所属 Task 中显式定义。
