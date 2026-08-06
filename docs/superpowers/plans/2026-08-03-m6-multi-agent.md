# M6 多 Agent 协作 (Multi-Agent) 实现计划 — Squad 对齐 Multica

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本计划依赖 M0–M5:`packages/core`(AgentEngine/ToolRegistry/ModelRouter/ContextManager)、main IPC(ApprovalCenter J2/TaskOrchestrator)、SQLite schema v1(tasks/squads/agent_messages/agent_call_edges 表)、渲染层 store/i18n。
>
> **覆盖能力(§10.6 M6 行)**:F7–F11、F15、K5、L12–L15、L31、I5。Q1:A — Squad 数据结构、Leader 路由、消息总线 L12–L15 与 Multica SOP 对齐,本里程碑在 App 内实现,M7 起 jarvis-daemon 作为 Multica Client 桥接。

**Goal:** 打通多 Agent 协作闭环:用户向 Leader 下发任务 → Leader(LLM)按 Multica SOP 用 `delegate_agent` 分派给成员 → 成员独立 REACT 执行 → 消息总线(L12)传递结果 → 按上下文策略(L13)传递 → Leader 汇总 → in_review → 人类审批(F15)→ 通知(I5);调用链(L14)与深度/循环防护(L15)贯穿;DAG 工作流(F10)拓扑执行;Agent 持久记忆(F11)与配置版本回滚(L31)落地;K5 时间线/日志流可视化。

**Architecture:** 协作协议在 `packages/core/src/squad/`(纯逻辑):消息总线(L12)、delegate 工具与防护(L15)、Squad 状态机与路由器(F8/F9)、上下文策略(L13)、调用链(L14)、DAG 工作流(F10)。`packages/core/src/memory/` 提供持久记忆(F11)。main 做接线:engine 注册 delegate/memory 工具、bus 落库 agent_messages、squad 审批/通知、版本快照(migration v4)。渲染层新增 Squad 视图(K5/L14 可视化)与审批/通知 UI。Multica 协议本身在 M7。

**Tech Stack:** M0–M5 技术栈 + `reactflow`(L14 调用链图)、Electron `Notification`(I5)。

## Global Constraints

(继承 M0–M5 全部约束。M6 相关复述:)

- **Q1:A Squad 对齐 Multica SOP:** 用户 → Leader → delegate_agent(@成员)→ 成员独立 REACT → 结果回传 Leader → Leader 汇总 → Squad.status = in_review → F15 用户审批 → completed。
- **L15 防护:** 最大委派深度默认 5;循环检测 `(from,to,taskHash)` 重复 → 终止并报错。
- **L13 上下文传递:** `full | summary | conclusion-only | custom template` 四策略,由 strategy 模板 engine 执行。
- **L14 调用链:** `agent_call_edges` 表(DAG)+ react-flow 可视化;工作流 UI 可视化编辑器后置 M8(K6/DAG)。
- **L12 消息总线:** `agent_messages` 表 + in-memory bus 路由;请求/响应/委派/完成四类消息。
- **F10 DAG 编排:** 工作流 JSON `{ nodes, edges }` 拓扑序执行;每节点输出写入下一节点 context。
- **L31 版本历史:** `agent_config_versions` 表(migration v4)+ JSON diff 回滚。
- **I5 通知:** App 内 Toast + Task badge;系统级 Electron Notification 仅 task:complete / task:failed。
- **每表单写者(§13.3):** `squads`/`agent_messages`/`agent_call_edges` 表归 daemon 属主;M2–M6 本地执行由 main 写入,M7 起 Multica 路径由 daemon 写入(见 M2/M3 说明)。M6 新增 `agent_memory`/`agent_config_versions` 表归 main。
- **F11 记忆:** 按 agent 键值持久记忆;engine 构造时把记忆摘要注入 system prompt。
- **i18n:** M6 新增 UI(Squad 视图/时间线/审批/版本历史)须 zh-CN/en 对称。

## 文件结构总览(本里程碑新增)

```
packages/core/src/squad/
├── Bus.ts / Bus.spec.ts              # L12 消息总线
├── Delegate.ts / Delegate.spec.ts    # F7/F9 delegate_agent 工具 + L15 防护
├── SquadMachine.ts / spec            # F8 状态机
├── SquadRouter.ts / spec             # F8/F9 Leader 路由编排
├── ContextStrategy.ts / spec         # L13 上下文传递策略
├── CallGraph.ts / spec               # L14 调用链 + 循环检测
├── Workflow.ts / spec                # F10 DAG 拓扑执行
├── agents/diff.ts / spec             # L31 配置 diff
└── index.ts
packages/core/src/memory/
├── MemoryStore.ts / spec             # F11 持久记忆 + 工具
└── index.ts
apps/desktop/src/main/
├── ipc/squad.ts                      # squad CRUD / 状态 / 审批
├── ipc/agents-versions.ts            # L31 快照/回滚
├── ipc/agents.ts                     # 修改:update 时写版本快照
├── notify/NotificationBridge.ts      # I5 系统通知
├── db/migrations.ts                  # 追加 v4:agent_memory / agent_config_versions
└── IpcRouter.ts
apps/desktop/src/renderer/src/
├── components/squad/
│   ├── SquadViewPage.tsx / spec      # K5 Squad 总览
│   ├── TimelineView.tsx / spec       # K5 执行时间线
│   ├── CallGraphView.tsx             # L14 react-flow
│   ├── ApprovalPanel.tsx / spec      # F15 squad 审批
│   ├── VersionHistoryPage.tsx / spec # L31 版本历史 + 回滚
│   └── ToastHost.tsx / spec          # I5 App 内通知
└── stores/squad-store.ts, toast-store.ts
```

---

### Task 1: Agent 消息总线(L12)

**Files:**
- Create: `packages/core/src/squad/Bus.ts`
- Create: `packages/core/src/squad/Bus.spec.ts`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `AgentMessageKind = 'request'|'response'|'delegate'|'complete'|'log'`
  - `AgentMessage { id; kind; from; to; taskId?; payload; ts }`
  - `MessageBus { post(msg); subscribe(fn): unsubscribe; request(req, timeoutMs?): Promise<AgentMessage> }` — 内存路由;`response` 按 `(to, taskId)` 匹配 pending waiter。
  - `waiterKey(to, taskId)`、`BusError`。
  - main 接线:bus 订阅 → 写 `agent_messages` 表(见 Step 4)。

- [ ] **Step 1: 编写失败测试**

`packages/core/src/squad/Bus.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { MessageBus } from './Bus';

describe('MessageBus', () => {
  it('delivers posted messages to subscribers', () => {
    const bus = new MessageBus();
    const seen: string[] = [];
    bus.subscribe(m => seen.push(m.kind));
    bus.post({ kind: 'request', from: 'a', to: 'b', taskId: 't1', payload: {} });
    expect(seen).toEqual(['request']);
  });

  it('resolves request when a response arrives', async () => {
    const bus = new MessageBus();
    const p = bus.request({ kind: 'delegate', from: 'leader', to: 'member', taskId: 't1', payload: { subtask: 'x' } }, 1000);
    bus.post({ kind: 'response', from: 'member', to: 'leader', taskId: 't1', payload: { text: 'done' } });
    const r = await p;
    expect(r.payload).toEqual({ text: 'done' });
  });

  it('rejects when no response arrives in time', async () => {
    const bus = new MessageBus();
    await expect(bus.request({ kind: 'delegate', from: 'a', to: 'b', taskId: 't', payload: {} }, 5)).rejects.toThrow('timeout');
  });

  it('unsubscribes a listener', () => {
    const bus = new MessageBus();
    let n = 0;
    const off = bus.subscribe(() => n++);
    off();
    bus.post({ kind: 'log', from: 'a', to: '*', payload: {} });
    expect(n).toBe(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/core && pnpm vitest run src/squad/Bus.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 编写实现**

`packages/core/src/squad/Bus.ts`:
```ts
export type AgentMessageKind = 'request' | 'response' | 'delegate' | 'complete' | 'log';
export interface AgentMessage {
  id: string; kind: AgentMessageKind; from: string; to: string;
  taskId?: string; payload: unknown; ts: number;
}
export class BusError extends Error {}

export function waiterKey(to: string, taskId?: string): string { return `${to}|${taskId ?? ''}`; }

export interface BusDeps { now?: () => number; id?: () => string }

export class MessageBus {
  private subs = new Set<(m: AgentMessage) => void>();
  private waiters = new Map<string, { resolve: (m: AgentMessage) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private deps: BusDeps = {}) {}

  post(msg: Omit<AgentMessage, 'id' | 'ts'>): AgentMessage {
    const full: AgentMessage = {
      ...msg,
      id: this.deps.id?.() ?? Math.random().toString(36).slice(2),
      ts: this.deps.now?.() ?? Date.now()
    };
    for (const s of [...this.subs]) s(full);
    if (msg.kind === 'response') {
      const key = waiterKey(msg.to, msg.taskId);
      const w = this.waiters.get(key);
      if (w) { clearTimeout(w.timer); this.waiters.delete(key); w.resolve(full); }
    }
    return full;
  }

  subscribe(fn: (m: AgentMessage) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  request(req: { kind: 'request' | 'delegate'; from: string; to: string; taskId?: string; payload: unknown }, timeoutMs = 60_000): Promise<AgentMessage> {
    return new Promise((resolve, reject) => {
      const key = waiterKey(req.to, req.taskId);
      const timer = setTimeout(() => {
        this.waiters.delete(key);
        reject(new BusError(`no response from ${req.to} within ${timeoutMs}ms`));
      }, timeoutMs);
      this.waiters.set(key, { resolve, timer });
      this.post({ ...req, kind: req.kind });
    });
  }
}
```

- [ ] **Step 4: 运行测试确认通过 + main 落库**

Run: `cd packages/core && pnpm vitest run src/squad/Bus.spec.ts`
Expected: PASS。

main(main/ipc/squad.ts)接线:
```ts
export function createBusPersist(db: Database.Database, bus: MessageBus): () => void {
  const ins = db.prepare('INSERT INTO agent_messages (id, kind, from_agent, to_agent, task_id, payload_json, created_at) VALUES (?,?,?,?,?,?,?)');
  return bus.subscribe(m => {
    ins.run(m.id, m.kind, m.from, m.to, m.taskId ?? null, JSON.stringify(m.payload), new Date(m.ts).toISOString());
  });
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/squad/Bus.ts packages/core/src/squad/Bus.spec.ts packages/core/src/squad/index.ts apps/desktop/src/main/ipc/squad.ts apps/desktop/src/main/ipc/IpcRouter.ts
git commit -m "feat(squad): agent message bus with persist to agent_messages (L12)"
```

---

### Task 2: delegate_agent 工具 + 深度/循环防护(F7/F9/L15)

**Files:**
- Create: `packages/core/src/squad/Delegate.ts`
- Create: `packages/core/src/squad/Delegate.spec.ts`

**Interfaces:**
- Consumes: M2 ToolRegistry;Task 1 Bus。
- Produces:
  - `DelegateGuardState { depth; visited: Set<string>; maxDepth }`;`createGuard(maxDepth?): DelegateGuardState`
  - `cycleKey(from, to, taskHash)`;`checkDelegate(state, from, to, taskHash): void` — 深度超限/循环抛 `DelegateGuardError`。
  - `finishDelegate(state)` — 归还深度。
  - `registerDelegateTool(registry, deps)` — 注册 `delegate_agent { agent, subtask }`,执行前 checkDelegate、执行后 finishDelegate;handler 调 `deps.route(to, subtask, from, taskId)`。

- [ ] **Step 1: 编写失败测试**

`packages/core/src/squad/Delegate.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { createGuard, checkDelegate, finishDelegate, cycleKey, registerDelegateTool } from './Delegate';
import { ToolRegistry } from '../agent/ToolRegistry';

describe('delegate guard', () => {
  it('blocks beyond max depth', () => {
    const g = createGuard(2);
    checkDelegate(g, 'a', 'b', 'h');
    checkDelegate(g, 'b', 'c', 'h');
    expect(() => checkDelegate(g, 'c', 'd', 'h')).toThrow('depth');
  });

  it('detects delegation cycles on same (from,to,taskHash)', () => {
    const g = createGuard(5);
    checkDelegate(g, 'a', 'b', 'h1');
    expect(() => checkDelegate(g, 'a', 'b', 'h1')).toThrow('cycle');
    expect(() => checkDelegate(g, 'a', 'b', 'h2')).not.toThrow();
  });

  it('finishDelegate returns a depth slot', () => {
    const g = createGuard(1);
    checkDelegate(g, 'a', 'b', 'h');
    finishDelegate(g);
    expect(() => checkDelegate(g, 'b', 'c', 'h')).not.toThrow();
  });

  it('registers a delegate_agent tool that routes and guards', async () => {
    const reg = new ToolRegistry();
    const guard = createGuard(5);
    const route = vi.fn(async () => 'member result');
    registerDelegateTool(reg, { guard, route, fromAgent: 'leader', taskHash: () => 'h', taskId: () => 't1' });
    const r = await reg.execute({ id: '1', name: 'delegate_agent', arguments: { agent: 'member', subtask: 'write tests' } }, { cwd: '/', env: {} });
    expect(r.output).toContain('member result');
    expect(route).toHaveBeenCalledWith('member', 'write tests', 'leader', 't1');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/core && pnpm vitest run src/squad/Delegate.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 编写实现**

`packages/core/src/squad/Delegate.ts`:
```ts
import type { ToolRegistry } from '../agent/ToolRegistry';

export class DelegateGuardError extends Error {}
export interface DelegateGuardState { depth: number; visited: Set<string>; maxDepth: number }

export function createGuard(maxDepth = 5): DelegateGuardState {
  return { depth: 0, visited: new Set(), maxDepth };
}

export function cycleKey(from: string, to: string, taskHash: string): string {
  return `${from}->${to}#${taskHash}`;
}

export function checkDelegate(state: DelegateGuardState, from: string, to: string, taskHash: string): void {
  if (state.depth >= state.maxDepth) throw new DelegateGuardError(`max delegation depth ${state.maxDepth} exceeded`);
  const key = cycleKey(from, to, taskHash);
  if (state.visited.has(key)) throw new DelegateGuardError(`delegation cycle detected: ${key}`);
  state.visited.add(key);
  state.depth++;
}

export function finishDelegate(state: DelegateGuardState): void {
  state.depth = Math.max(0, state.depth - 1);
}

export interface DelegateToolDeps {
  guard: DelegateGuardState;
  route: (to: string, subtask: string, from: string, taskId: string) => Promise<string>;
  fromAgent: string;
  taskHash: () => string;
  taskId: () => string;
}

export function registerDelegateTool(registry: ToolRegistry, deps: DelegateToolDeps): void {
  registry.register({
    name: 'delegate_agent',
    description: 'Delegate a subtask to another agent and wait for its result',
    parameters: { type: 'object', properties: { agent: { type: 'string' }, subtask: { type: 'string' } }, required: ['agent', 'subtask'] }
  }, async (args) => {
    const to = String(args.agent);
    const subtask = String(args.subtask);
    checkDelegate(deps.guard, deps.fromAgent, to, deps.taskHash());
    try {
      const result = await deps.route(to, subtask, deps.fromAgent, deps.taskId());
      return { ok: true, output: result };
    } finally {
      finishDelegate(deps.guard);
    }
  });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/core && pnpm vitest run src/squad/Delegate.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/squad/Delegate.ts packages/core/src/squad/Delegate.spec.ts packages/core/src/squad/index.ts
git commit -m "feat(squad): delegate_agent tool with depth and cycle guards (F7/F9/L15)"
```

---

### Task 3: Squad 状态机 + Leader 路由编排(F8/F9)

**Files:**
- Create: `packages/core/src/squad/SquadMachine.ts`
- Create: `packages/core/src/squad/SquadMachine.spec.ts`
- Create: `packages/core/src/squad/SquadRouter.ts`
- Create: `packages/core/src/squad/SquadRouter.spec.ts`

**Interfaces:**
- Consumes: Task 1 Bus、Task 2 Delegate。
- Produces:
  - `SquadStatus = 'idle'|'in_progress'|'in_review'|'completed'|'cancelled'|'failed'`;`SquadEvent`
  - `squadTransition(state, event): SquadStatus` — 状态机(TABLE)。
  - `Squad { id; leaderAgentId; memberAgentIds; status; taskId? }`;`createSquad(input): Squad`
  - `runSquad(squad, taskInput, deps): Promise<SquadResult>` — Leader run → 逐个成员 run → summarize → 返回 in_review + members。
  - `SquadRouterDeps { runLeader; runMember; summarize; buildContext }`;`SquadResult { squadId; status; summary; members }`
  - main:squad store CRUD(`squads` 表)+ IPC;engine 为 Leader 注册 delegate_agent 工具,route 内部经 `runSquad` 执行成员。

- [ ] **Step 1: 编写失败测试**

`packages/core/src/squad/SquadMachine.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { squadTransition, createSquad } from './SquadMachine';

describe('squad state machine', () => {
  it('follows the happy path', () => {
    let s = squadTransition('idle', 'start');
    s = squadTransition(s, 'summarized');
    expect(s).toBe('in_review');
    expect(squadTransition(s, 'approve')).toBe('completed');
  });

  it('rejects from in_review goes back to in_progress', () => {
    expect(squadTransition('in_review', 'reject')).toBe('in_progress');
  });

  it('throws on invalid transition', () => {
    expect(() => squadTransition('completed', 'start')).toThrow('invalid transition');
  });

  it('creates a squad with default idle status', () => {
    const s = createSquad({ leaderAgentId: 'l', memberAgentIds: ['m1', 'm2'] });
    expect(s.status).toBe('idle');
    expect(s.memberAgentIds).toHaveLength(2);
  });
});
```

`packages/core/src/squad/SquadRouter.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { runSquad } from './SquadRouter';

describe('runSquad', () => {
  it('delegates to members and summarizes into in_review', async () => {
    const deps = {
      runLeader: async () => ({ text: 'plan', delegations: [{ to: 'm1', subtask: 'a' }, { to: 'm2', subtask: 'b' }] }),
      runMember: async (agentId: string) => `result of ${agentId}`,
      buildContext: async (s: string) => s,
      summarize: async (members: Array<{ agent: string; result: string }>) => members.map(m => m.result).join(';')
    };
    const squad = { id: 's1', leaderAgentId: 'leader', memberAgentIds: ['m1', 'm2'], status: 'in_progress' as const };
    const r = await runSquad(squad, 'task input', deps);
    expect(r.status).toBe('in_review');
    expect(r.members).toHaveLength(2);
    expect(r.summary).toContain('result of m1');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/core && pnpm vitest run src/squad/SquadMachine.spec.ts src/squad/SquadRouter.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 编写实现**

`packages/core/src/squad/SquadMachine.ts`:
```ts
export type SquadStatus = 'idle' | 'in_progress' | 'in_review' | 'completed' | 'cancelled' | 'failed';
export type SquadEvent = 'start' | 'summarized' | 'approve' | 'reject' | 'cancel' | 'fail';
export class SquadStateError extends Error {}

const TRANSITIONS: Record<SquadStatus, Partial<Record<SquadEvent, SquadStatus>>> = {
  idle: { start: 'in_progress', cancel: 'cancelled', fail: 'failed' },
  in_progress: { summarized: 'in_review', cancel: 'cancelled', fail: 'failed' },
  in_review: { approve: 'completed', reject: 'in_progress', cancel: 'cancelled' },
  completed: {},
  cancelled: {},
  failed: {}
};

export function squadTransition(state: SquadStatus, event: SquadEvent): SquadStatus {
  const next = TRANSITIONS[state]?.[event];
  if (!next) throw new SquadStateError(`invalid transition ${state} --${event}-> ?`);
  return next;
}

export interface Squad { id: string; leaderAgentId: string; memberAgentIds: string[]; status: SquadStatus; taskId?: string }

export function createSquad(input: { leaderAgentId: string; memberAgentIds: string[]; id?: string; status?: SquadStatus; taskId?: string }): Squad {
  return {
    id: input.id ?? '', leaderAgentId: input.leaderAgentId, memberAgentIds: input.memberAgentIds,
    status: input.status ?? 'idle', taskId: input.taskId
  };
}
```

`packages/core/src/squad/SquadRouter.ts`:
```ts
import type { Squad } from './SquadMachine';

export interface SquadRouterDeps {
  runLeader(input: string): Promise<{ text: string; delegations: Array<{ to: string; subtask: string }> }>;
  runMember(agentId: string, subtask: string, context: string): Promise<string>;
  buildContext(result: string): Promise<string>;
  summarize(members: Array<{ agent: string; result: string }>): Promise<string>;
}
export interface SquadResult { squadId: string; status: 'in_review'; summary: string; members: Array<{ agent: string; result: string }> }

export async function runSquad(squad: Squad, taskInput: string, deps: SquadRouterDeps): Promise<SquadResult> {
  const { delegations } = await deps.runLeader(taskInput);
  const members: Array<{ agent: string; result: string }> = [];
  for (const d of delegations.slice(0, squad.memberAgentIds.length)) {
    const context = await deps.buildContext(`[Leader 指示]\n${taskInput}`);
    const result = await deps.runMember(d.to, d.subtask, context);
    members.push({ agent: d.to, result });
  }
  const summary = await deps.summarize(members);
  return { squadId: squad.id, status: 'in_review', summary, members };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/core && pnpm vitest run src/squad/SquadMachine.spec.ts src/squad/SquadRouter.spec.ts`
Expected: PASS。

- [ ] **Step 5: main squad store + Leader engine 接线**

`apps/desktop/src/main/ipc/squad.ts`:
```ts
import { createSquad, squadTransition, runSquad } from '@jarvis/core';

export function createSquadStore(db: Database.Database) {
  const list = () => (db.prepare('SELECT * FROM squads ORDER BY created_at DESC').all() as Array<Record<string, unknown>>).map(r => ({
    id: r.id as string, leaderAgentId: r.leader_agent_id as string, memberAgentIds: JSON.parse(r.member_agent_ids_json as string) as string[], status: r.status as string, taskId: r.task_id as string | null
  }));
  return {
    list,
    create(input: { id: string; leaderAgentId: string; memberAgentIds: string[]; taskId?: string }) {
      db.prepare('INSERT INTO squads (id, leader_agent_id, member_agent_ids_json, status, task_id, created_at) VALUES (?,?,?,?,?,?)')
        .run(input.id, input.leaderAgentId, JSON.stringify(input.memberAgentIds), 'idle', input.taskId ?? null, new Date().toISOString());
    },
    transition(id: string, event: 'start' | 'summarized' | 'approve' | 'reject' | 'cancel' | 'fail') {
      const cur = list().find(s => s.id === id);
      if (!cur) throw new Error('squad not found');
      const next = squadTransition(cur.status as never, event);
      db.prepare('UPDATE squads SET status = ? WHERE id = ?').run(next, id);
      return next;
    }
  };
}
```

Leader engine 构造:注册 `delegate_agent` 工具,`route` 经 `runSquad` 的成员路径(实际 member run 用独立 engine + 独立 MCP/Sandbox)。IPC:`squad.create`、`squad.start { id, input }`(内部 runSquad → transition summarized → 推事件)、`squad.approve { id, ok }`。

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/squad/SquadMachine.ts packages/core/src/squad/SquadMachine.spec.ts packages/core/src/squad/SquadRouter.ts packages/core/src/squad/SquadRouter.spec.ts apps/desktop/src/main/ipc/squad.ts apps/desktop/src/main/ipc/tasks.ts
git commit -m "feat(squad): squad state machine and leader routing orchestration (F8/F9)"
```

---

### Task 4: 上下文传递策略(L13)

**Files:**
- Create: `packages/core/src/squad/ContextStrategy.ts`
- Create: `packages/core/src/squad/ContextStrategy.spec.ts`

**Interfaces:**
- Consumes: M5 `substituteTemplate`。
- Produces:
  - `ContextPassingStrategy = 'full'|'summary'|'conclusion'|'custom'`
  - `buildPassedContext(strategy, result, opts?): Promise<string>` — full 原样;summary 走 `opts.summarize`(缺省截断 2000);conclusion 抽 `结论/总结` 行;custom 用模板替换(`{{result}}` + `opts.vars`)。
  - main:SquadRouter 的 `buildContext` 按 agent 配置的 `context_passing` 策略调用。

- [ ] **Step 1: 编写失败测试**

`packages/core/src/squad/ContextStrategy.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildPassedContext } from './ContextStrategy';

describe('context strategies', () => {
  it('passes full result', async () => {
    expect(await buildPassedContext('full', 'whole text')).toBe('whole text');
  });

  it('summarizes or truncates', async () => {
    expect(await buildPassedContext('summary', 'long text', { summarize: async s => `SUM:${s}` })).toBe('SUM:long text');
    expect((await buildPassedContext('summary', 'x'.repeat(5000))).length).toBeLessThanOrEqual(2000);
  });

  it('extracts conclusion lines only', async () => {
    const result = '背景...\n结论:方案 A\n细节...\n总结:可行';
    const c = await buildPassedContext('conclusion', result);
    expect(c).toContain('方案 A');
    expect(c).toContain('可行');
    expect(c).not.toContain('背景');
  });

  it('renders a custom template', async () => {
    const c = await buildPassedContext('custom', 'RES', { template: '结果:{{result}} 来源:{{src}}', vars: { src: 'm1' } });
    expect(c).toBe('结果:RES 来源:m1');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/core && pnpm vitest run src/squad/ContextStrategy.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 编写实现**

`packages/core/src/squad/ContextStrategy.ts`:
```ts
import { substituteTemplate } from '../office/templates';

export type ContextPassingStrategy = 'full' | 'summary' | 'conclusion' | 'custom';

export interface ContextOpts {
  template?: string;
  summarize?: (s: string) => Promise<string>;
  vars?: Record<string, string>;
}

export async function buildPassedContext(strategy: ContextPassingStrategy, result: string, opts: ContextOpts = {}): Promise<string> {
  switch (strategy) {
    case 'full':
      return result;
    case 'summary':
      if (opts.summarize) return opts.summarize(result);
      return result.length > 2000 ? result.slice(0, 2000) : result;
    case 'conclusion': {
      const lines = result.split('\n').filter(l => /^(结论|总结|结论:|总结:|\[结论\])/.test(l.trim()));
      return lines.length ? lines.join('\n') : result.slice(0, 1000);
    }
    case 'custom':
      return substituteTemplate(opts.template ?? '{{result}}', { ...opts.vars, result });
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/core && pnpm vitest run src/squad/ContextStrategy.spec.ts`
Expected: PASS。

- [ ] **Step 5: 接线到 SquadRouter**

在 main 中把 `runSquad` 的 `buildContext` 参数改为按 agent 的 `context_passing` 策略:
```ts
buildContext: async (result) => buildPassedContext(agent.contextPassing ?? 'full', result)
```
(上下文同时注入 Task 5 调用链与记忆。)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/squad/ContextStrategy.ts packages/core/src/squad/ContextStrategy.spec.ts packages/core/src/squad/index.ts apps/desktop/src/main/ipc/squad.ts
git commit -m "feat(squad): context passing strategies full/summary/conclusion/custom (L13)"
```

---

### Task 5: 调用链追踪(L14)

**Files:**
- Create: `packages/core/src/squad/CallGraph.ts`
- Create: `packages/core/src/squad/CallGraph.spec.ts`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `CallEdge { id; from; to; taskId?; ok; ts }`
  - `CallGraph { addEdge(from, to, opts?); getEdges(); toRows(): Array<{ from; to; label }> }`
  - `detectCycle(edges): boolean` — 重复 `(from,to,taskId)` 判定循环。
  - main:bus/engine 在 delegate 完成时写 `agent_call_edges`(agent_call_edges 表);IPC `squad.graph { squadId }`。

- [ ] **Step 1: 编写失败测试**

`packages/core/src/squad/CallGraph.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { CallGraph, detectCycle, type CallEdge } from './CallGraph';

describe('call graph', () => {
  it('records edges and builds react-flow rows', () => {
    const g = new CallGraph();
    g.addEdge('a', 'b', { taskId: 't1' });
    g.addEdge('b', 'c', { taskId: 't1', ok: false });
    const rows = g.toRows();
    expect(rows).toEqual([
      { from: 'a', to: 'b', label: 'ok' },
      { from: 'b', to: 'c', label: 'failed' }
    ]);
  });

  it('detects a repeated delegation as a cycle', () => {
    const g = new CallGraph();
    g.addEdge('a', 'b', { taskId: 't1' });
    g.addEdge('a', 'b', { taskId: 't1' });
    expect(detectCycle(g.getEdges())).toBe(true);
    expect(detectCycle([{ id: '1', from: 'a', to: 'b', ok: true, ts: 1 }] as CallEdge[])).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/core && pnpm vitest run src/squad/CallGraph.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 编写实现**

`packages/core/src/squad/CallGraph.ts`:
```ts
export interface CallEdge { id: string; from: string; to: string; taskId?: string; ok: boolean; ts: number }
export interface GraphRow { from: string; to: string; label: string }

export class CallGraph {
  private edges: CallEdge[] = [];
  constructor(private now: () => number = () => Date.now()) {}

  addEdge(from: string, to: string, opts: { taskId?: string; ok?: boolean } = {}): CallEdge {
    const e: CallEdge = { id: `${from}->${to}#${opts.taskId ?? ''}-${this.edges.length}`, from, to, taskId: opts.taskId, ok: opts.ok ?? true, ts: this.now() };
    this.edges.push(e);
    return e;
  }

  getEdges(): CallEdge[] { return [...this.edges]; }

  toRows(): GraphRow[] {
    return this.edges.map(e => ({ from: e.from, to: e.to, label: e.ok ? 'ok' : 'failed' }));
  }
}

export function detectCycle(edges: CallEdge[]): boolean {
  const seen = new Set<string>();
  for (const e of edges) {
    const k = `${e.from}->${e.to}#${e.taskId ?? ''}`;
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
}
```

- [ ] **Step 4: 运行测试确认通过 + main 接线**

Run: `cd packages/core && pnpm vitest run src/squad/CallGraph.spec.ts`
Expected: PASS。

main:engine 的 delegate route 完成后:
```ts
db.prepare('INSERT INTO agent_call_edges (id, from_agent, to_agent, task_id, ok, created_at) VALUES (?,?,?,?,?,?)')
  .run(randomUUID(), from, to, taskId, ok, new Date().toISOString());
```
IPC `squad.graph { squadId }` → 查该 squad 关联 task 的 edges → `toRows()`。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/squad/CallGraph.ts packages/core/src/squad/CallGraph.spec.ts packages/core/src/squad/index.ts apps/desktop/src/main/ipc/squad.ts apps/desktop/src/main/ipc/tasks.ts
git commit -m "feat(squad): call graph tracking with cycle detection (L14)"
```

---

### Task 6: DAG 工作流编排(F10)

**Files:**
- Create: `packages/core/src/squad/Workflow.ts`
- Create: `packages/core/src/squad/Workflow.spec.ts`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `AgentNode { id; agentId; input }`;`Edge { from; to }`;`Workflow { nodes; edges }`
  - `topoSort(wf): string[]` — 拓扑序,含环抛 `DagError`。
  - `runWorkflow(wf, runNode): Promise<Record<string, string>>` — 按拓扑序执行,把上游输出注入下游 input。
  - main:`workflow.run { definitionJson }`;UI 可视化编辑器后置 M8(K6/DAG)。

- [ ] **Step 1: 编写失败测试**

`packages/core/src/squad/Workflow.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { topoSort, runWorkflow, DagError, type Workflow } from './Workflow';

const wf: Workflow = {
  nodes: [
    { id: 'a', agentId: 'A', input: 'seed' },
    { id: 'b', agentId: 'B', input: '' },
    { id: 'c', agentId: 'C', input: '' }
  ],
  edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'c' }]
};

describe('workflow', () => {
  it('topologically sorts', () => {
    const order = topoSort(wf);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
  });

  it('throws on cycle', () => {
    const cyc: Workflow = { nodes: [{ id: 'x', agentId: 'X', input: '' }, { id: 'y', agentId: 'Y', input: '' }], edges: [{ from: 'x', to: 'y' }, { from: 'y', to: 'x' }] };
    expect(() => topoSort(cyc)).toThrow(DagError);
  });

  it('passes upstream output into downstream input', async () => {
    const runNode = async (n: { id: string; agentId: string; input: string }) => `OUT(${n.id})=${n.input}`;
    const outputs = await runWorkflow(wf, runNode);
    expect(outputs.c).toContain('OUT(a)');  // b 的输出包含 a 的输出注入
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/core && pnpm vitest run src/squad/Workflow.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 编写实现**

`packages/core/src/squad/Workflow.ts`:
```ts
export interface AgentNode { id: string; agentId: string; input: string }
export interface Edge { from: string; to: string }
export interface Workflow { nodes: AgentNode[]; edges: Edge[] }
export class DagError extends Error {}

export function topoSort(wf: Workflow): string[] {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of wf.nodes) { indeg.set(n.id, 0); adj.set(n.id, []); }
  for (const e of wf.edges) {
    if (!indeg.has(e.from) || !indeg.has(e.to)) throw new DagError(`edge references unknown node: ${e.from}->${e.to}`);
    indeg.set(e.to, indeg.get(e.to)! + 1);
    adj.get(e.from)!.push(e.to);
  }
  const q = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const order: string[] = [];
  while (q.length) {
    const cur = q.shift()!;
    order.push(cur);
    for (const nx of adj.get(cur) ?? []) {
      indeg.set(nx, indeg.get(nx)! - 1);
      if (indeg.get(nx) === 0) q.push(nx);
    }
  }
  if (order.length !== wf.nodes.length) throw new DagError('workflow contains a cycle');
  return order;
}

export async function runWorkflow(wf: Workflow, runNode: (node: AgentNode, context: string) => Promise<string>): Promise<Record<string, string>> {
  const order = topoSort(wf);
  const outputs: Record<string, string> = {};
  for (const id of order) {
    const node = wf.nodes.find(n => n.id === id)!;
    const upstream = wf.edges.filter(e => e.to === id).map(e => `[${e.from} 输出]\n${outputs[e.from] ?? ''}`).join('\n');
    outputs[id] = await runNode(node, upstream ? `${node.input}\n${upstream}` : node.input);
  }
  return outputs;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/core && pnpm vitest run src/squad/Workflow.spec.ts`
Expected: PASS。

- [ ] **Step 5: main workflow.run IPC**

```ts
this.register('workflow.run', async (_e, definitionJson: string) => {
  const wf = JSON.parse(definitionJson) as Workflow;
  const outputs = await runWorkflow(wf, async (node, context) => {
    return runAgentOnce(node.agentId, context); // 复用 M2 engine 单次执行
  });
  return { ok: true, outputs };
});
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/squad/Workflow.ts packages/core/src/squad/Workflow.spec.ts packages/core/src/squad/index.ts apps/desktop/src/main/ipc/squad.ts
git commit -m "feat(squad): DAG workflow topo execution (F10)"
```

---

### Task 7: Agent 持久记忆(F11)

**Files:**
- Create: `packages/core/src/memory/MemoryStore.ts`
- Create: `packages/core/src/memory/MemoryStore.spec.ts`
- Modify: `apps/desktop/src/main/db/migrations.ts`(追加 v4)

**Interfaces:**
- Consumes: M2 ToolRegistry;M0 MIGRATIONS。
- Produces:
  - `MemoryEntry { id; agentId; key; value; updatedAt }`
  - `MemoryAdapter { upsert; get; list; remove }`;`MemoryStore { memorize; recall; forget }`
  - `buildMemoryInjection(entries): string` — 注入 system prompt 的 `<memory>` 块。
  - `registerMemoryTools(registry, store, agentId)` — `memorize`/`recall` 工具。
  - main:`agent_memory` 表(migration v4)+ adapter;engine 构造时注入记忆。

- [ ] **Step 1: 追加 v4 迁移**

`apps/desktop/src/main/db/migrations.ts` 追加:
```ts
{
  version: 4,
  sql: `
  CREATE TABLE IF NOT EXISTS agent_memory (
    id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, key TEXT NOT NULL,
    value TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(agent_id, key)
  );
  CREATE INDEX IF NOT EXISTS idx_agent_memory_agent ON agent_memory(agent_id);
  CREATE TABLE IF NOT EXISTS agent_config_versions (
    id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_agent_config_versions_agent ON agent_config_versions(agent_id, created_at);`
}
```

- [ ] **Step 2: 编写失败测试**

`packages/core/src/memory/MemoryStore.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { MemoryStore, buildMemoryInjection, type MemoryAdapter, type MemoryEntry } from './MemoryStore';
import { registerMemoryTools } from './MemoryStore';
import { ToolRegistry } from '../agent/ToolRegistry';

const mkAdapter = (): MemoryAdapter => {
  const rows = new Map<string, MemoryEntry>();
  return {
    upsert(agentId, key, value) { const id = `${agentId}:${key}`; rows.set(id, { id, agentId, key, value, updatedAt: new Date().toISOString() }); },
    get(agentId, key) { return rows.get(`${agentId}:${key}`) ?? null; },
    list(agentId) { return [...rows.values()].filter(r => r.agentId === agentId); },
    remove(agentId, key) { rows.delete(`${agentId}:${key}`); }
  };
};

describe('memory store', () => {
  it('memorizes, recalls and forgets', () => {
    const store = new MemoryStore(mkAdapter());
    store.memorize('a', 'style', 'concise');
    expect(store.recall('a', 'style')[0].value).toBe('concise');
    expect(store.recall('a').length).toBe(1);
    store.forget('a', 'style');
    expect(store.recall('a').length).toBe(0);
  });

  it('builds an injection block', () => {
    const store = new MemoryStore(mkAdapter());
    store.memorize('a', 'lang', 'zh');
    const block = buildMemoryInjection(store.recall('a'));
    expect(block).toContain('<memory>');
    expect(block).toContain('lang: zh');
    expect(buildMemoryInjection([])).toBe('');
  });

  it('exposes memorize/recall tools', async () => {
    const reg = new ToolRegistry();
    const store = new MemoryStore(mkAdapter());
    registerMemoryTools(reg, store, 'a');
    await reg.execute({ id: '1', name: 'memorize', arguments: { key: 'pref', value: 'short answers' } }, { cwd: '/', env: {} });
    const r = await reg.execute({ id: '2', name: 'recall', arguments: {} }, { cwd: '/', env: {} });
    expect(r.output).toContain('pref: short answers');
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd packages/core && pnpm vitest run src/memory/MemoryStore.spec.ts`
Expected: FAIL。

- [ ] **Step 4: 编写实现**

`packages/core/src/memory/MemoryStore.ts`:
```ts
import type { ToolRegistry } from '../agent/ToolRegistry';

export interface MemoryEntry { id: string; agentId: string; key: string; value: string; updatedAt: string }
export interface MemoryAdapter {
  upsert(agentId: string, key: string, value: string): void;
  get(agentId: string, key: string): MemoryEntry | null;
  list(agentId: string): MemoryEntry[];
  remove(agentId: string, key: string): void;
}

export class MemoryStore {
  constructor(private adapter: MemoryAdapter, private now: () => string = () => new Date().toISOString()) {}

  memorize(agentId: string, key: string, value: string): MemoryEntry {
    this.adapter.upsert(agentId, key, value);
    return this.adapter.get(agentId, key)!;
  }

  recall(agentId: string, key?: string): MemoryEntry[] {
    if (key) { const e = this.adapter.get(agentId, key); return e ? [e] : []; }
    return this.adapter.list(agentId);
  }

  forget(agentId: string, key: string): void {
    this.adapter.remove(agentId, key);
  }
}

export function buildMemoryInjection(entries: MemoryEntry[]): string {
  if (entries.length === 0) return '';
  return '\n<memory>\n' + entries.map(e => `${e.key}: ${e.value}`).join('\n') + '\n</memory>';
}

export function registerMemoryTools(registry: ToolRegistry, store: MemoryStore, agentId: string): void {
  registry.register({
    name: 'memorize', description: 'Store a persistent memory for the current agent',
    parameters: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key', 'value'] }
  }, async (args) => {
    store.memorize(agentId, String(args.key), String(args.value));
    return { ok: true, output: 'remembered' };
  });

  registry.register({
    name: 'recall', description: 'Recall stored memories for the current agent',
    parameters: { type: 'object', properties: { key: { type: 'string' } } }
  }, async (args) => {
    const items = store.recall(agentId, args.key ? String(args.key) : undefined);
    return { ok: true, output: items.map(i => `${i.key}: ${i.value}`).join('\n') || 'no memories' };
  });
}
```

- [ ] **Step 5: 运行测试确认通过 + main 接线**

Run: `cd packages/core && pnpm vitest run src/memory/MemoryStore.spec.ts`
Expected: PASS。

main:`createMemoryAdapter(db)`(agent_memory 表)→ 每 agent 一个 `MemoryStore`;engine 构造时:
```ts
const system = `${agent.systemPrompt}${buildMemoryInjection(memory.recall(agentId))}`;
registerMemoryTools(engineRegistry, memory, agentId);
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/memory apps/desktop/src/main/db/migrations.ts apps/desktop/src/main/ipc/agents.ts apps/desktop/src/main/ipc/tasks.ts
git commit -m "feat(memory): persistent agent memory with memorize/recall tools (F11)"
```

---

### Task 8: Squad 级审批(F15)+ 通知(I5)

**Files:**
- Create: `apps/desktop/src/main/notify/NotificationBridge.ts`
- Create: `packages/core/src/squad/Notify.ts`
- Create: `packages/core/src/squad/Notify.spec.ts`
- Create: `apps/desktop/src/renderer/src/components/squad/ApprovalPanel.tsx`
- Create: `apps/desktop/src/renderer/src/components/squad/ApprovalPanel.spec.tsx`
- Create: `apps/desktop/src/renderer/src/components/squad/ToastHost.tsx`
- Create: `apps/desktop/src/renderer/src/components/squad/ToastHost.spec.tsx`
- Create: `apps/desktop/src/renderer/src/stores/toast-store.ts`

**Interfaces:**
- Consumes: M3 ApprovalCenter(J2);Task 3 squad 状态机。
- Produces:
  - `buildTaskNotification(status, task): { notify; title; body }` — 仅 complete/failed 通知。
  - main `showSystemNotification(title, body)`(Electron Notification);Toast store(App 内)。
  - `squad.approve { id, ok }` IPC → 状态机 approve/reject + 通知。
  - `ApprovalPanel`(in_review 时展示成员结果 + 通过/驳回)、`ToastHost`。

- [ ] **Step 1: 编写失败测试**

`packages/core/src/squad/Notify.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildTaskNotification } from './Notify';

describe('notify policy', () => {
  it('notifies only on complete and failed', () => {
    expect(buildTaskNotification('complete', { title: 't' }).notify).toBe(true);
    expect(buildTaskNotification('failed', { title: 't' }).notify).toBe(true);
    expect(buildTaskNotification('running', { title: 't' }).notify).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/core && pnpm vitest run src/squad/Notify.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 编写实现**

`packages/core/src/squad/Notify.ts`:
```ts
export interface NotifyDecision { notify: boolean; title: string; body: string }
export type TaskEndStatus = 'complete' | 'failed' | 'running';

export function buildTaskNotification(status: TaskEndStatus, task: { title: string }): NotifyDecision {
  if (status !== 'complete' && status !== 'failed') return { notify: false, title: '', body: '' };
  return { notify: true, title: `Task ${status}`, body: task.title };
}
```

`apps/desktop/src/main/notify/NotificationBridge.ts`:
```ts
import { Notification } from 'electron';

export function showSystemNotification(title: string, body: string): void {
  if (!Notification.isSupported()) return;
  new Notification({ title, body }).show();
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/core && pnpm vitest run src/squad/Notify.spec.ts`
Expected: PASS。

- [ ] **Step 5: Toast store + 组件**

`apps/desktop/src/renderer/src/stores/toast-store.ts`:
```ts
export interface Toast { id: string; kind: 'info' | 'success' | 'error'; message: string }
let toasts: Toast[] = [];
const listeners = new Set<(ts: Toast[]) => void>();
export function toast(kind: Toast['kind'], message: string): void {
  const t = { id: Math.random().toString(36).slice(2), kind, message };
  toasts = [...toasts, t];
  listeners.forEach(l => l(toasts));
  setTimeout(() => { toasts = toasts.filter(x => x.id !== t.id); listeners.forEach(l => l(toasts)); }, 4000);
}
export function subscribeToasts(fn: (ts: Toast[]) => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }
```

`apps/desktop/src/renderer/src/components/squad/ToastHost.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { subscribeToasts, type Toast } from '../../stores/toast-store';

export function ToastHost() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => subscribeToasts(setItems), []);
  return (
    <div data-testid="toast-host">
      {items.map(t => <div key={t.id} data-testid={`toast-${t.kind}`} className={`toast toast--${t.kind}`}>{t.message}</div>)}
    </div>
  );
}
```

main:task 状态变化到 complete/failed 时:
```ts
const d = buildTaskNotification(status, task);
if (d.notify) { showSystemNotification(d.title, d.body); sendToRenderer('toast:push', { kind: status === 'complete' ? 'success' : 'error', message: d.body }); }
```

- [ ] **Step 6: ApprovalPanel + 冒烟测试**

`apps/desktop/src/renderer/src/components/squad/ApprovalPanel.tsx`:
```tsx
export function ApprovalPanel({ squadId, summary, members, onDone }: {
  squadId: string; summary: string; members: Array<{ agent: string; result: string }>;
  onDone: () => void;
}) {
  const decide = async (ok: boolean) => {
    await window.jarvis.invoke('squad.approve', squadId, ok);
    onDone();
  };
  return (
    <div data-testid="approval-panel">
      <h3>审批</h3>
      <p data-testid="approval-summary">{summary}</p>
      <ul>{members.map(m => <li key={m.agent} data-testid={`approval-member-${m.agent}`}>{m.agent}: {m.result}</li>)}</ul>
      <button data-testid="approval-ok" onClick={() => void decide(true)}>通过</button>
      <button data-testid="approval-no" onClick={() => void decide(false)}>驳回</button>
    </div>
  );
}
```

`ApprovalPanel.spec.tsx`:render + 点通过 → invoke `squad.approve`。

- [ ] **Step 7: 运行测试确认通过 + i18n 对称**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/components/squad/ApprovalPanel.spec.tsx src/renderer/src/components/squad/ToastHost.spec.tsx && cd /Users/baofengbaofeng/Workspace/github/baofengbaofeng/Jarvis && node scripts/i18n-check.mjs`
Expected: PASS + 对称。

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/squad/Notify.ts packages/core/src/squad/Notify.spec.ts apps/desktop/src/main/notify apps/desktop/src/main/ipc/squad.ts apps/desktop/src/main/ipc/tasks.ts apps/desktop/src/renderer/src/components/squad/ApprovalPanel.tsx apps/desktop/src/renderer/src/components/squad/ApprovalPanel.spec.tsx apps/desktop/src/renderer/src/components/squad/ToastHost.tsx apps/desktop/src/renderer/src/stores/toast-store.ts packages/i18n/locales
git commit -m "feat(squad): squad-level approval and task notifications (F15/I5)"
```

---

### Task 9: Agent 配置版本历史与回滚(L31)

**Files:**
- Create: `packages/core/src/squad/agents/diff.ts`
- Create: `packages/core/src/squad/agents/diff.spec.ts`
- Create: `apps/desktop/src/main/ipc/agents-versions.ts`
- Modify: `apps/desktop/src/main/ipc/agents.ts`(update 时写快照)
- Create: `apps/desktop/src/renderer/src/components/squad/VersionHistoryPage.tsx`
- Create: `apps/desktop/src/renderer/src/components/squad/VersionHistoryPage.spec.tsx`

**Interfaces:**
- Consumes: M4 `diffLines`/`groupHunks`/`toUnified`;Task 7 migration v4(agent_config_versions)。
- Produces:
  - `changedFields(a, b): string[]`;`diffConfigJson(a, b): string`(unified diff 文本)。
  - main `createAgentVersionStore(db)`:snapshot/list/rollback;IPC `agents.versions { id }`、`agents.rollback { id, versionId }`。
  - `VersionHistoryPage`:版本列表 + 变更高亮 + 一键回滚。

- [ ] **Step 1: 编写失败测试**

`packages/core/src/squad/agents/diff.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { changedFields, diffConfigJson } from './diff';

describe('agent config diff', () => {
  it('detects changed fields', () => {
    expect(changedFields({ a: 1, b: 'x' }, { a: 2, b: 'x' })).toEqual(['a']);
  });

  it('produces a unified diff text', () => {
    const d = diffConfigJson({ name: 'A', model: 'm1' }, { name: 'A', model: 'm2' });
    expect(d).toContain('-');
    expect(d).toContain('+');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/core && pnpm vitest run src/squad/agents/diff.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 编写实现**

`packages/core/src/squad/agents/diff.ts`:
```ts
import { diffLines, groupHunks, toUnified } from '../../coding/diff';

export function changedFields(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

export function diffConfigJson(a: Record<string, unknown>, b: Record<string, unknown>): string {
  const hunks = groupHunks(diffLines(JSON.stringify(a, null, 2).split('\n'), JSON.stringify(b, null, 2).split('\n')));
  return hunks.length ? toUnified(hunks) : '(no changes)';
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/core && pnpm vitest run src/squad/agents/diff.spec.ts`
Expected: PASS。

- [ ] **Step 5: main 版本 store + 接线**

`apps/desktop/src/main/ipc/agents-versions.ts`:
```ts
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export function createAgentVersionStore(db: Database.Database, getAgent: (id: string) => Record<string, unknown>, applyAgent: (cfg: Record<string, unknown>) => void) {
  const ins = db.prepare('INSERT INTO agent_config_versions (id, agent_id, snapshot_json, created_at) VALUES (?,?,?,?)');
  return {
    snapshot(agentId: string) {
      const cfg = getAgent(agentId);
      ins.run(randomUUID(), agentId, JSON.stringify(cfg), new Date().toISOString());
    },
    list(agentId: string) {
      return (db.prepare('SELECT * FROM agent_config_versions WHERE agent_id = ? ORDER BY created_at DESC').all(agentId) as Array<Record<string, unknown>>).map(r => ({
        id: r.id as string, createdAt: r.created_at as string, fields: Object.keys(JSON.parse(r.snapshot_json as string))
      }));
    },
    rollback(versionId: string) {
      const v = db.prepare('SELECT snapshot_json FROM agent_config_versions WHERE id = ?').get(versionId) as { snapshot_json: string } | undefined;
      if (!v) throw new Error(`version ${versionId} not found`);
      applyAgent(JSON.parse(v.snapshot_json));
    }
  };
}
```

在 `agents.update`(M2 agents.ts)写库前调用 `versionStore.snapshot(agentId)`,并在 update 返回前附上 `changedFields(old, next)`。IPC:`agents.versions { id }`、`agents.rollback { id, versionId }`。

- [ ] **Step 6: VersionHistoryPage + 冒烟测试**

`apps/desktop/src/renderer/src/components/squad/VersionHistoryPage.tsx`:
```tsx
import { useEffect, useState } from 'react';

export function VersionHistoryPage({ agentId }: { agentId: string }) {
  const [versions, setVersions] = useState<Array<{ id: string; createdAt: string; fields: string[] }>>([]);
  const [diff, setDiff] = useState('');
  const refresh = async () => setVersions((await window.jarvis.invoke('agents.versions', agentId)) as typeof versions);
  useEffect(() => { void refresh(); }, [agentId]);
  const rollback = async (versionId: string) => { await window.jarvis.invoke('agents.rollback', agentId, versionId); setDiff('已回滚'); await refresh(); };
  return (
    <div data-testid="version-history">
      <h3>版本历史</h3>
      <ul>{versions.map(v => (
        <li key={v.id}>
          {v.createdAt} — {v.fields.join(', ')}
          <button data-testid={`rollback-${v.id}`} onClick={() => void rollback(v.id)}>回滚</button>
        </li>
      ))}</ul>
      <pre data-testid="version-diff">{diff}</pre>
    </div>
  );
}
```

`VersionHistoryPage.spec.tsx`:mock invoke 返回 1 条版本,点回滚断言调用。

- [ ] **Step 7: 运行测试确认通过 + i18n 对称**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/components/squad/VersionHistoryPage.spec.tsx && cd /Users/baofengbaofeng/Workspace/github/baofengbaofeng/Jarvis && node scripts/i18n-check.mjs`
Expected: PASS + 对称。

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/squad/agents apps/desktop/src/main/ipc/agents-versions.ts apps/desktop/src/main/ipc/agents.ts apps/desktop/src/main/ipc/IpcRouter.ts apps/desktop/src/renderer/src/components/squad/VersionHistoryPage.tsx apps/desktop/src/renderer/src/components/squad/VersionHistoryPage.spec.tsx packages/i18n/locales
git commit -m "feat(squad): agent config version history and rollback (L31)"
```

---

### Task 10: K5 时间线/日志流 + Squad 视图 + M6 验收

**Files:**
- Create: `apps/desktop/src/renderer/src/components/squad/TimelineView.tsx`
- Create: `apps/desktop/src/renderer/src/components/squad/TimelineView.spec.tsx`
- Create: `apps/desktop/src/renderer/src/components/squad/CallGraphView.tsx`
- Create: `apps/desktop/src/renderer/src/pages/SquadViewPage.tsx`
- Create: `apps/desktop/src/renderer/src/pages/SquadViewPage.spec.tsx`
- Create: `apps/desktop/src/renderer/src/stores/squad-store.ts`

**Interfaces:**
- Consumes: Task 5 CallGraph;Task 8 ApprovalPanel;M2 task 日志事件。
- Produces:
  - `TimelineView({ events })` — 事件流(K5);`SquadEvent { agent; ts; kind; detail }`。
  - `CallGraphView({ rows })` — react-flow 边渲染(L14)。
  - `SquadViewPage`:Leader/成员卡 + 状态 + Timeline + CallGraph + ApprovalPanel。
  - main:把 squad/agent 事件(bus 订阅 + task 日志)推给渲染层 `squad:event`。
  - **S5 场景验收**(见清单)。

- [ ] **Step 1: 编写 TimelineView + 冒烟测试**

`apps/desktop/src/renderer/src/stores/squad-store.ts`:
```ts
export interface SquadEvent { agent: string; ts: number; kind: string; detail: string }
let events: SquadEvent[] = [];
const listeners = new Set<(es: SquadEvent[]) => void>();
export function pushSquadEvent(e: SquadEvent): void {
  events = [...events, e].slice(-200);
  listeners.forEach(l => l(events));
}
export function subscribeSquadEvents(fn: (es: SquadEvent[]) => void): () => void {
  listeners.add(fn); return () => listeners.delete(fn);
}
```

`apps/desktop/src/renderer/src/components/squad/TimelineView.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { subscribeSquadEvents, type SquadEvent } from '../../stores/squad-store';

export function TimelineView() {
  const [events, setEvents] = useState<SquadEvent[]>([]);
  useEffect(() => subscribeSquadEvents(setEvents), []);
  return (
    <ul data-testid="timeline" className="timeline">
      {events.map((e, i) => (
        <li key={i} data-testid={`timeline-${e.kind}`} className="timeline__item">
          <span className="timeline__time">{new Date(e.ts).toLocaleTimeString()}</span>
          <span className="timeline__agent">{e.agent}</span> {e.detail}
        </li>
      ))}
    </ul>
  );
}
```

`apps/desktop/src/renderer/src/components/squad/TimelineView.spec.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TimelineView } from './TimelineView';
import { pushSquadEvent } from '../../stores/squad-store';

describe('TimelineView', () => {
  it('renders pushed events', () => {
    render(<TimelineView />);
    pushSquadEvent({ agent: 'leader', ts: Date.now(), kind: 'start', detail: 'delegating' });
    expect(screen.getByTestId('timeline-start')).toBeTruthy();
  });
});
```

- [ ] **Step 2: CallGraphView(react-flow)**

`apps/desktop/src/renderer/src/components/squad/CallGraphView.tsx`:
```tsx
import { useEffect, useMemo, useState } from 'react';
import ReactFlow, { type Edge, type Node } from 'reactflow';
import 'reactflow/dist/style.css';

export function CallGraphView({ rows }: { rows: Array<{ from: string; to: string; label: string }> }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  useEffect(() => {
    const agents = [...new Set(rows.flatMap(r => [r.from, r.to]))];
    setNodes(agents.map((a, i) => ({ id: a, position: { x: i * 160, y: 40 }, data: { label: a } })));
    setEdges(rows.map((r, i) => ({ id: `e${i}`, source: r.from, target: r.to, label: r.label })));
  }, [rows]);
  return <div data-testid="call-graph" style={{ width: '100%', height: 240 }}><ReactFlow nodes={nodes} edges={edges} fitView /></div>;
}
```

- [ ] **Step 3: SquadViewPage + 冒烟测试**

`apps/desktop/src/renderer/src/pages/SquadViewPage.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { TimelineView } from '../components/squad/TimelineView';
import { CallGraphView } from '../components/squad/CallGraphView';
import { ApprovalPanel } from '../components/squad/ApprovalPanel';

interface SquadState { id: string; leaderAgentId: string; memberAgentIds: string[]; status: string; summary?: string; members?: Array<{ agent: string; result: string }>; graphRows?: Array<{ from: string; to: string; label: string }> }

export function SquadViewPage() {
  const [squad, setSquad] = useState<SquadState | null>(null);
  const refresh = async () => setSquad((await window.jarvis.invoke('squad.current')) as SquadState);
  useEffect(() => { void refresh(); const iv = setInterval(() => void refresh(), 3000); return () => clearInterval(iv); }, []);
  if (!squad) return <div data-testid="squad-view" />;
  return (
    <div data-testid="squad-view">
      <h2>Squad {squad.id} — {squad.status}</h2>
      <div>Leader: {squad.leaderAgentId} / Members: {squad.memberAgentIds.join(', ')}</div>
      <CallGraphView rows={squad.graphRows ?? []} />
      <TimelineView />
      {squad.status === 'in_review' && squad.summary != null && squad.members != null && (
        <ApprovalPanel squadId={squad.id} summary={squad.summary} members={squad.members} onDone={() => void refresh()} />
      )}
    </div>
  );
}
```

`apps/desktop/src/renderer/src/pages/SquadViewPage.spec.tsx`:mock `squad.current` → in_review,断言 ApprovalPanel 出现。

main 接线:bus 订阅 + task 日志事件 → `squad:event` 推渲染层(pushSquadEvent)。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/pages/SquadViewPage.spec.tsx src/renderer/src/components/squad/TimelineView.spec.tsx`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/components/squad apps/desktop/src/renderer/src/pages/SquadViewPage.tsx apps/desktop/src/renderer/src/stores/squad-store.ts apps/desktop/src/main/ipc/squad.ts apps/desktop/src/main/ipc/tasks.ts
git commit -m "feat(squad): timeline/log stream and squad view with call graph (K5/L14)"
```

---

### M6 验收清单(Self-Review 对照)

**§21 M6 交付(M6 多Agent | Squad、消息总线、审批、通知 | S5 场景):**
- [x] F8/F9 Squad:Leader 路由分派 — Task 3(SquadMachine/SquadRouter)+ Task 2(delegate_agent)
- [x] L12 消息总线 — Task 1(Bus + agent_messages 落库)
- [x] F15 人类审批(Squad 级)— Task 8(ApprovalPanel/squad.approve)
- [x] I5 通知(App 内 + 系统,仅 complete/failed)— Task 8(ToastHost/NotificationBridge)

**§10.6 M6 行(F7–F11,F15,L12–L15,L31,I5,K5):**
- [x] F7 @唤醒/调用 — Task 2(delegate_agent)
- [x] F9 Leader 按任务分派 — Task 3
- [x] F10 DAG 工作流 — Task 6(topoSort/runWorkflow)
- [x] F11 持久记忆 — Task 7(MemoryStore + memorize/recall)
- [x] L13 上下文传递策略 — Task 4(full/summary/conclusion/custom)
- [x] L14 调用链追踪/循环检测 — Task 5(CallGraph/detectCycle)+ Task 10(CallGraphView)
- [x] L15 最大委派深度/循环防护 — Task 2(DelegateGuard)
- [x] L31 配置版本历史/回滚 — Task 9(VersionHistoryPage + diff)
- [x] K5 执行时间线/日志流 — Task 10(TimelineView)

**S5 场景验收(端到端):** 用户向 Leader 下发任务 → Leader 调 `delegate_agent` 分派成员 → 成员独立 REACT(独立 workspace/MCP)→ 结果经消息总线回传 → 按上下文策略传递 → Leader 汇总 → `in_review` → 用户在 ApprovalPanel 通过/驳回 → 通知(Toast + 可选系统)送达;调用链在 CallGraphView 可视化;深度/循环被 L15 拦截;配置回滚可用。

**M6 已知后置:** Multica 协议/ACP/jarvis-agent CLI 与 jarvis-daemon 注册、15s 心跳/3s 轮询接单、流式回传(M7);F12 cron/事件触发(可后置于 M8);DAG 工作流 UI 可视化编辑器(M8 K6);系统级全局能力(A3/I1–I4,V2.0)。
