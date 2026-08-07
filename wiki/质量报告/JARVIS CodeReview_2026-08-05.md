# JARVIS 代码审查报告

| 项目 | 内容 |
|------|------|
| **产品** | JARVIS 1.0.0-Preview（本地优先 AI 桌面助手） |
| **审查日期** | 2026-08-05 |
| **最后更新** | 2026-08-06（Phase 4 续：SEC-07 / ROB-07 / store 单测） |
| **审查范围** | 全栈：Electron 主进程 / 渲染层 / `packages/core` 引擎 / Go daemon / `packages/protocol` |
| **参考文档** | `CLAUDE.md`、M0–M8 实现计划（`docs/superpowers/plans/`）、`wiki/技术文档/JARVIS技术方案_1.0.0-Preview_20260802.html` |
| **审查方式** | 静态代码走查 + 架构约束对照 + 安全边界分析 + 测试覆盖抽样 |

---

## 整改状态总览

| 阶段 | 范围 | 状态 |
|------|------|------|
| Phase 1 | P0 安全止血（SEC-01–03、SEC-04 部分、SEC-05–06） | **已完成** |
| Phase 2 | 核心能力闭环（ROB-01、STD-01、STD-03、ROB-02） | **已完成** |
| Phase 3 | 质量与可维护性（ROB-03/04 部分、SEC-08–09、ARCH-01 文档化） | **已完成** |
| Phase 4 | 架构拆分与 IPC 统一（ARCH-02/03、STD-02 部分、ROB-05 部分） | **已完成** |
| Phase 4 续 | SEC-07、ROB-07、agent/toast store 单测 | **已完成** |
| 遗留 | ARCH-01 写路径收敛、全量 Electron E2E、部分页面 IPC 常量 | **待办** |

**验证记录（2026-08-06）**：`workspace-path-guard.spec.ts`、`agent-store.spec.ts`、`toast-store.spec.ts`、`IpcRouter.spec.ts`、protocol 测试通过。

---

## 1. 执行摘要

JARVIS 在 1.0.0-Preview 冻结阶段已建立起较清晰的 **五层架构**（SQLite → Go daemon → Electron Main/IPC → `packages/core` 引擎 → React 渲染层），核心设计决策（决策 A：引擎唯一实现在 TS、`@jarvis/core/renderer` 分包、IPC 值返回约定、Keychain 存密钥）在多数模块中得到贯彻，**`packages/core` 业务逻辑测试覆盖较好**，沙箱、审批门、审计日志等安全基础设施已具备雏形。

本次审查共识别 **4 项高优先级（P0）**、**12 项中优先级（P1）**、**若干低优先级（P2/P3）** 问题。**截至 2026-08-05，P0 项已全部修复，P1 项大部分已修复，P2 项中 ARCH-02/03、STD-02（部分）、ROB-05（契约层）已完成。**

原报告四项最优先问题现状：

| # | 原问题 | 状态 | 关键改动 |
|---|--------|------|----------|
| 1 | Preload IPC 无白名单 | **已修复** | `packages/protocol/src/ipc-allowlist.ts` + preload `assertAllowedInvoke/Event` |
| 2 | REACT 未向模型注册 tools | **已修复** | `ChatRequest.tools`、OpenAI/Anthropic adapter、`AgentEngine` 注入 |
| 3 | 沙箱路径/IO 不一致 + symlink | **已修复** | `Sandbox.realpathSync`、`file.ts` 使用 canonical 路径 |
| 4 | 关键路径测试与 ErrorBoundary | **部分修复** | 根级 `ErrorBoundary`；`chat`/`task`/`approval` store 单测；`agent-store` 仍缺 |

**总体评价**：架构方向正确、分层意识强；**IPC 安全边界、沙箱完备性、引擎工具调用闭环、coding IPC 路径校验** 均已落地。剩余工作集中在 **task 写者长期收敛（ARCH-01）**、**真实 Electron E2E** 与 **页面层 IPC 常量统一**。

---

## 2. 审查范围与方法

（与初版相同，略）

### 2.1 审查范围

| 层级 | 关键路径 |
|------|----------|
| 引擎层 | `packages/core/src/agent/`、`model/`、`tools/`、`sandbox/`、`task/`、`mcp/` |
| 主进程 | `apps/desktop/src/main/ipc/`、`secrets/`、`daemon/`、`db/migrations.ts` |
| 渲染层 | `apps/desktop/src/renderer/src/stores/`、`components/`、`pages/` |
| 预加载 | `apps/desktop/src/preload/index.ts` |
| 协议层 | `packages/protocol/src/` |
| Go 运行时 | `daemon/internal/httpapi/`、`runtime/`、`multica/` |
| 测试 | `*.spec.ts`、`apps/desktop/e2e/` |

### 2.2 对照约束

审查以 M0 Global Constraints 及 `CLAUDE.md` 中的硬性规则为基准，重点核对：

- Q4：禁止硬编码 model id
- 决策 A：引擎唯一 TS 实现，Go 仅为瘦壳
- 渲染层仅允许 `@jarvis/core/renderer` 导入
- API Key 不落盘明文
- 每表单写者原则（§13.3）
- i18n zh-CN/en 对称、禁止硬编码 UI 字符串
- IPC 值返回 `{ ok: true/false }` 约定

---

## 3. 架构审查

### 3.1 架构符合项（亮点）

（与初版相同，略）

| 项 | 说明 |
|----|------|
| 引擎归属（决策 A） | `AgentEngine`、`ModelRouter`、工具注册、MCP 客户端均集中在 `packages/core`；`tasks.ts` 通过共享 `AgentEngine` 执行任务，Go `jarvis-agent` 未重复实现 REACT 循环。 |
| 协议解耦 | `packages/protocol` 独立定义 `IpcChannel`/`IpcEvent`，不依赖 `@jarvis/core`。 |
| 并发安全修复痕迹 | `AgentEngine.run` 将 `input.agent` 传入审批门与工具上下文，避免共享引擎下 module-level 状态竞态（M4/M6 review finding）。 |
| 分层职责 | 纯逻辑在 core、main 负责持久化与 IPC 接线、renderer 以 zustand + 视图为主，整体符合「core 纯逻辑 / main 接线 / renderer 视图」约定。 |
| SQLite 迁移纪律 | `migrations.ts` 采用追加式版本迁移，v10/v11 对遗留表的修正有注释说明。 |

### 3.2 架构问题

#### ARCH-01 【中】单表写者原则部分偏离 — **部分修复（文档化）**

**现状**：文档规定 Go daemon 为 `tasks`/`squads` 等表的写者；实际 Electron main 仍直接写 `tasks` 表。

**已做**：
- `tasks.ts` 顶部补充 §13.3 架构例外说明（1.0.0-Preview 单用户路径由 main 统一驱动）。

**遗留**：
- 中期仍将 task 写操作收敛到 daemon HTTP API 或 stdio 委托，main 仅做 IPC 转发。

---

#### ARCH-02 【中】`IpcRouter.registerAll` 职责过重 — **已修复**

**已做**：
- `IpcRouter.ts` 精简为聚合层（~150 行）。
- 按域拆分：`register-agents-ipc.ts`、`register-coding-ipc.ts`、`register-safety-ipc.ts`。

---

#### ARCH-03 【中】`tasks.ts` 上帝模块 — **已修复**

**已做**：
```
task-messages.ts      # buildTaskMessages、appendAudit、session adapter
task-engine-factory.ts # AgentEngine + ToolRegistry + approval gate
task-squad-bridge.ts  # Squad runner + delegate_agent
tasks.ts              # orchestrator + IPC handlers（~170 行）
```

---

#### ARCH-04 【低】`packages/ui` / `packages/views` 仍为脚手架 — **未修复（1.0.0-Preview 可接受）**

**改进方案**：V1.1+ 将可复用组件逐步下沉至 `packages/ui`。

---

## 4. 代码规范审查

### 4.1 符合项

（与初版相同，略）

### 4.2 规范问题

#### STD-01 【中】渲染层违反 `@jarvis/core/renderer` 边界 — **已修复**

5 处违规导入已改为 `@jarvis/core/renderer`。

---

#### STD-02 【中】IPC 通道命名不一致 — **部分修复（stores 层基本完成）**

**已做**：
- `ipc-channels.ts` 增补 `workspaceTree`、`indexReindex`、`diffApplyAll`、`taskboardList` 等。
- 全部核心 stores 已改用 `IpcChannel`（含 `agent-store`、`provider-store`、`taskboard-store`）。

**遗留**：部分页面组件（office/coding/settings 页）仍使用裸字符串 invoke。

---

#### STD-03 【中】i18n 违规硬编码字符串 — **已修复**

已增补 zh-CN/en 对称 key（`chat.taskCancelled`、`error.*`、`usage.*`、`audit.*`、`daemon.*` 等），`pnpm i18n:check` 通过。

---

#### STD-04 【低】主进程部分 handler 参数类型松散 — **未修复**

**示例**：`runtime.ts` 仍使用 `(...args: any[])`。

---

## 5. 安全性审查

### 5.1 安全符合项

（与初版相同；另增）

| 项 | 说明 |
|----|------|
| Preload 白名单 | `assertAllowedInvoke` / `assertAllowedEvent` 在 preload 层强制执行 |
| Daemon HTTP 认证 | 非 `/health` 路由需 `Bearer` token（`JARVIS_DAEMON_TOKEN`） |
| 跨平台密钥 | macOS Keychain + 其他平台 `safeStorage` 加密文件（`createSecureStorage.ts`） |

### 5.2 安全问题

#### SEC-01 【高】Preload 未对 IPC 通道做白名单校验 — **已修复**

**实现**：`packages/protocol/src/ipc-allowlist.ts`、`apps/desktop/src/preload/index.ts`。

---

#### SEC-02 【高】`fs.readFile` 可读任意路径 — **已修复**

**实现**：移除通用 `fs.readFile`；改为 `config.readPickedFile`（`picked-file.ts`），仅允许 dialog 选定路径。

---

#### SEC-03 【高】`secrets.*` IPC 对渲染层完全开放 — **已修复**

**实现**：`secretsGet`/`secretsSet`/`secretsDelete` **不在** `ALLOWED_INVOKE` 中；main 内部仍通过 `createSecureStorage()` 使用。

---

#### SEC-04 【高】`backup.restore` / `config.import` 缺少路径与来源校验 — **已修复（backup）**

**实现**：`backup.ts` 校验路径须在 backup 目录内且以 `.db` 结尾。

**说明**：`config.import` 仍依赖文本内容校验（`schemaVersion` 等），未强制 dialog 路径绑定（风险低于任意 `fs.readFile`）。

---

#### SEC-05 【中高】沙箱未解析符号链接 — **已修复**

**实现**：`Sandbox.ts` 使用 `realpathSync`，`assertRead`/`assertWrite` 返回 canonical 路径。

---

#### SEC-06 【中高】文件工具校验路径与实际 IO 路径不一致 — **已修复**

**实现**：`file.ts` 所有 IO 使用 sandbox 返回的 canonical 路径。

---

#### SEC-07 【中】`index.reindex` / `diff.applyAll` IPC 缺少工作区边界校验 — **已修复**

**实现**：`workspace-path-guard.ts`（`assertAllowedWorkspaceRoot`、`assertWorkspaceRelPath`）；`register-coding-ipc.ts` 在 reindex/diff 入口强制校验。

---

#### SEC-08 【中】Daemon HTTP API 无认证 — **已修复**

**实现**：`daemon/internal/httpapi/auth.go`；`DaemonSupervisor` 生成 token 并经 env 传递。

---

#### SEC-09 【中】`SecureStorage` 仅实现 macOS — **已修复**

**实现**：`SecureStorage.ts`（可注入加解密）+ `createSecureStorage.ts`（darwin Keychain / 其他平台 `safeStorage` + `~/.jarvis/secrets/`）。

---

#### SEC-10 【低】`sandbox: false` 扩大 Preload 权限面 — **已缓解**

**说明**：SEC-01 白名单已作为补偿控制落地；保持文档化即可。

---

## 6. 健壮性审查

### 6.1 健壮性符合项

（与初版相同，略）

### 6.2 健壮性问题

#### ROB-01 【高】REACT 循环未向模型注册 Tools — **已修复**

**实现**：
- `ChatRequest` 增加 `tools`/`toolChoice`。
- `AgentEngine` 从 `ToolRegistry` 注入（经 `visibleTools` 过滤）。
- OpenAI/Anthropic adapter 下发 tools。

---

#### ROB-02 【高】全局缺少 React ErrorBoundary — **已修复（根级）**

**实现**：`ErrorBoundary.tsx` 包裹 `App.tsx` 根节点。

**遗留**：`WorkflowEditor`、`CodingPanelPage`、`PdfReaderPage` 路由级边界仍可选增强。

---

#### ROB-03 【高】关键 Zustand Store 无单测 — **部分修复**

**已覆盖**：`chat-store`、`task-store`、`approval-store`、**`agent-store`**、**`toast-store`**（+ 原有 `workflow`、`runtime`、`settings`/`theme`）。

**仍缺**：`squad-store`、`provider-store`（无 spec）、`init-store`、`usage-store`、`taskboard-store` 等。

---

#### ROB-04 【中】Store 在模块加载时注册 IPC 订阅 — **已修复**

**实现**：`ipc-subscriptions.ts` + `initIpcSubscriptions()`，由 `init-store.ts` 显式调用；各 store 移除模块级 `onDidReceive`。

---

#### ROB-05 【中】E2E 覆盖严重不足 — **部分修复**

**已做**：
- 新增 `e2e/ipc-allowlist.spec.ts`：验证 `IpcChannel`/`IpcEvent` 与 preload allowlist 一致，且 `secrets.*` 不可 invoke。
- `packages/protocol/src/index.spec.ts` 同步契约断言。

**遗留**：
- `e2e/smoke.spec.ts` 仍为 Vite + mock bridge（非真实 Electron IPC）。
- `e2e/s2-file-shell.spec.ts` 仍为占位；S2 工具链由 `packages/core/src/task/s2-toolchain.spec.ts` 覆盖。
- 真实 Playwright Electron 冒烟（聊天发送、任务生命周期）待建。

---

#### ROB-06 【中】`chat-store` 模块级可变状态 — **已修复**

**实现**：`taskSessionId` 移入 zustand state（`streamingTaskSessionId`）。

---

#### ROB-07 【低】`taskLogs` 内存 Map 无上限 — **已修复**

**实现**：`tasks.ts` 每任务日志缓冲上限 500 行（`MAX_TASK_LOG_LINES`）。

---

## 7. 问题汇总表

| ID | 类别 | 严重度 | 标题 | 原优先级 | **整改状态** |
|----|------|--------|------|----------|--------------|
| SEC-01 | 安全 | 高 | Preload IPC 无白名单 | P0 | **已修复** |
| SEC-02 | 安全 | 高 | `fs.readFile` 任意路径读取 | P0 | **已修复** |
| SEC-03 | 安全 | 高 | `secrets.*` 对渲染层开放 | P0 | **已修复** |
| ROB-01 | 健壮性 | 高 | REACT 未向模型注册 tools | P0 | **已修复** |
| SEC-04 | 安全 | 高 | backup/config 路径未约束 | P1 | **已修复（backup）** |
| SEC-05 | 安全 | 中高 | 沙箱 symlink 逃逸 | P1 | **已修复** |
| SEC-06 | 安全 | 中高 | 文件工具校验/IO 路径不一致 | P1 | **已修复** |
| ROB-02 | 健壮性 | 高 | 无 ErrorBoundary | P1 | **已修复（根级）** |
| ROB-03 | 健壮性 | 高 | 关键 store 无测试 | P1 | **部分修复** |
| ARCH-01 | 架构 | 中 | tasks 表写者偏离 | P1 | **部分修复（文档）** |
| ARCH-02 | 架构 | 中 | IpcRouter 过大 | P2 | **已修复** |
| ARCH-03 | 架构 | 中 | tasks.ts 上帝模块 | P2 | **已修复** |
| STD-01 | 规范 | 中 | renderer 错误导入 core | P1 | **已修复** |
| STD-02 | 规范 | 中 | IPC 常量不统一 | P2 | **部分修复** |
| STD-03 | 规范 | 中 | i18n 硬编码 | P1 | **已修复** |
| SEC-07 | 安全 | 中 | coding IPC 路径未校验 | P2 | **已修复** |
| SEC-08 | 安全 | 中 | daemon HTTP 无 token | P2 | **已修复** |
| SEC-09 | 安全 | 中 | SecureStorage 仅 macOS | P2 | **已修复** |
| ROB-04 | 健壮性 | 中 | store import 副作用 | P2 | **已修复** |
| ROB-05 | 健壮性 | 中 | E2E 不足 | P2 | **部分修复** |
| ROB-06 | 健壮性 | 中 | chat-store 模块级状态 | P3 | **已修复** |
| ROB-07 | 健壮性 | 低 | taskLogs 无界 | P3 | **已修复** |
| ARCH-04 | 架构 | 低 | ui/views 脚手架 | P3 | **未修复** |
| STD-04 | 规范 | 低 | runtime.ts any 参数 | P3 | **未修复** |
| SEC-10 | 安全 | 低 | sandbox:false 权衡 | 文档化 | **已缓解** |

**统计**：共 25 项 — 已修复 19、部分修复 5、未修复 1（ARCH-04 为 1.0.0-Preview 可接受项，STD-04 低优先级）。

---

## 8. 分阶段改进路线图

### Phase 1 — 安全止血 — **已完成**

1. ~~Preload IPC invoke/event 白名单（SEC-01）~~
2. ~~收紧 `fs.readFile`、`secrets.*`（SEC-02、SEC-03）~~
3. ~~`backup.restore` 路径约束（SEC-04）~~
4. ~~沙箱 `realpath` + 文件工具 canonical IO（SEC-05、SEC-06）~~

### Phase 2 — 核心能力闭环 — **已完成**

1. ~~`ChatRequest.tools` 与 adapter 下发（ROB-01）~~
2. ~~renderer `@jarvis/core` 导入与 i18n（STD-01、STD-03）~~
3. ~~根级 ErrorBoundary（ROB-02）~~

### Phase 3 — 质量与可维护性 — **已完成**

1. ~~`chat-store` / `approval-store` / `task-store` 单测（ROB-03 部分）~~
2. ~~拆分 `tasks.ts`、`IpcRouter.ts`（ARCH-02、ARCH-03）~~
3. ~~IPC allowlist 契约 E2E（ROB-05 部分）~~
4. ~~跨平台 SecureStorage（SEC-09）~~
5. ~~Daemon HTTP token（SEC-08）~~
6. ~~Store IPC 初始化重构（ROB-04）~~

### Phase 4 — 架构收敛 — **进行中**

| 项 | 状态 |
|----|------|
| Task 写路径与 daemon 对齐（ARCH-01） | 待办 |
| 全量 renderer IPC 常量统一（STD-02 页面层） | 待办 |
| 真实 Electron E2E smoke（ROB-05） | 待办 |
| 剩余 store 单测（ROB-03） | 待办 |

---

## 9. 测试与质量指标快照

| 指标 | 初版观测 | **当前（2026-08-05）** | 建议目标 |
|------|----------|------------------------|----------|
| renderer stores 单测覆盖 | 3/13（~23%） | **8/13（~62%）** | ≥ 8/13 |
| main 模块单测 | 29 spec / 45 ts（~64%） | **维持 ~64%+**（含拆分后 tasks/IpcRouter spec 42 项） | 80% |
| core 包单测 | 业务模块覆盖良好 | 维持 | 补 `mcp/register.ts`、`util/sse.ts` |
| E2E 场景 | 2（1 占位） | **3**（smoke×2 + ipc-allowlist×3 断言） | ≥ 5 条真实 Electron 冒烟 |
| i18n 对称 | 可通过 | **`pnpm i18n:check` ✓** | 0 违规 |
| IPC 契约 | 无 CI 校验 | **`e2e/ipc-allowlist.spec.ts` + protocol spec** | 持续 |

---

## 10. 结论

JARVIS 1.0.0-Preview 在 **架构分层、引擎单点实现、密钥不落盘、沙箱与审批基础设施** 方面达到了里程碑设计预期。经 Phase 1–4 整改后：

1. **Electron 安全模型最后一公里**（Preload 白名单 + 高危 IPC 收口）— **已落地**；
2. **Agent 工具调用端到端闭环** — **已落地**；
3. **沙箱路径语义正确性** — **已落地**；
4. **用户主路径测试与容错** — **部分落地**（根 ErrorBoundary + 3 个核心 store 单测；真实 E2E 与 `agent-store` 仍待补）。

建议后续按 **第八章 Phase 4 待办** 迭代；每项修复继续附带回归测试，并遵守 `pnpm i18n:check` 与单任务单提交约定。

---

## 附录 A：关键代码引用（整改后）

### Preload IPC 白名单

```1:17:apps/desktop/src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannel, assertAllowedInvoke, assertAllowedEvent } from '@jarvis/protocol';

contextBridge.exposeInMainWorld('jarvis', {
  invoke: (channel: string, ...args: unknown[]) => {
    assertAllowedInvoke(channel);
    return ipcRenderer.invoke(channel, ...args);
  },
  settingsGet: (key: string) => ipcRenderer.invoke(IpcChannel.settingsGet, key),
  settingsSet: (key: string, value: unknown) => ipcRenderer.invoke(IpcChannel.settingsSet, key, value),
  onDidReceive: (channel: string, cb: (payload: unknown) => void) => {
    assertAllowedEvent(channel);
    const listener = (_: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
```

### 沙箱 realpath 边界检查

```81:105:packages/core/src/sandbox/Sandbox.ts
  private resolveReadPath(absPath: string): string {
    const abs = isAbsolute(absPath) ? absPath : resolve(this.workspaceRoot, absPath);
    const real = realpathSync(abs);
    this.assertRealInside(real);
    return real;
  }
  // ...
  private assertRealInside(real: string): void {
    const root = realpathSync(this.workspaceRoot);
    const rel = relative(root, real);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new SandboxError(`outside workspace: ${real}`);
  }
```

### AgentEngine 工具注入

`AgentEngine.run()` 从 `ToolRegistry.list()` 构建 `ChatRequest.tools`（经 `visibleTools` 过滤），并传入 OpenAI/Anthropic adapter。

### ChatRequest tools 字段

```21:31:packages/core/src/model/types.ts
export interface ChatRequest {
  provider: Provider;
  modelId: string;
  messages: ModelMessage[];
  stream: boolean;
  maxTokens?: number;
  temperature?: number;
  reasoning?: 'low' | 'medium' | 'high';
  tools?: ChatToolDef[];
  toolChoice?: 'auto' | 'none';
}
```

### IpcRouter 域拆分入口

`IpcRouter.registerAll()` 调用 `registerAgentsIpc`、`registerCodingIpc`、`registerSafetyIpc` 聚合注册；任务路径见 `task-engine-factory.ts`、`task-squad-bridge.ts`、`task-messages.ts`。

---

*本报告由静态代码审查生成；整改状态于 2026-08-06 同步。未包含运行时渗透测试与性能压测。建议在真实 Electron E2E 落地后安排一轮专项安全复测。*
