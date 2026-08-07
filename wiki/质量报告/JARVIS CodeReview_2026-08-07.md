# JARVIS Code Review 报告（复审 + AI 可执行整改指引）

## 1. 基本信息

| 项目 | 内容 |
|---|---|
| 项目名称 | JARVIS 1.0.0-Preview（本地优先桌面 AI Agent 工作台） |
| 评审日期 | 2026-08-07 |
| 代码基线 | `master` HEAD `b30219eaec57c4e88bd8304814aa61ad4aad7302`（`feat(ui): P0-P5 full UI polish…`） |
| 评审范围 | Electron Main/Preload/Renderer、`packages/core`、`packages/protocol`、`packages/i18n`、`packages/ui`、Go daemon、测试、构建与依赖；对照 Wiki/里程碑计划与 `docs/superpowers/specs/2026-08-06-cr-remediation-design.md` |
| 技术栈 | Electron 32、React 19、TypeScript 5、Zustand、better-sqlite3、Go 1.25、SQLite WAL、pnpm/Turborepo、Vitest、Playwright |
| 评审方式 | 业务/架构基线对照、全仓静态走查、跨层调用链分析、安全信任边界深挖、既有 44 个 CR ID 状态复验、新增发现 |
| 前置报告 | `wiki/质量报告/JARVIS CodeReview_2026-08-06.md`（44 ID 基线）；本报告为 **复审更新版**，状态以本报告为准 |
| 结论 | **仍不建议发布 1.0.0-Preview**。SEC-01/02/07/08 等边界能力已部分落地，但核心产品闭环、工具协议、任务生命周期、Office 高危依赖、CI 门禁与多项安全缺口仍为 Open |

### 1.1 业务背景与目标（评审基线）

JARVIS 是面向个人办公的 **local-first** 跨平台 AI Agent 桌面工作台：

- 对话 / REACT 任务 / 编程辅助 / 办公增强 / Squad 多 Agent / Multica 运行时统一在 Electron 应用内完成。
- 数据默认本机 SQLite；API Key 经系统安全存储；无遥测、无云同步。
- 引擎唯一实现在 `packages/core`（决策 A）；Go daemon 负责调度/队列/Multica 协议壳。
- Preview 冻结级目标：S1–S6 主旅程可用、冷启动 `<3s`、daemon 就绪 `<1s`、zh-CN/en 对称、无硬编码模型 ID、密钥不明文落盘。

### 1.2 架构对齐快照

| 约束 | 现状 |
|---|---|
| Engine 只在 TS core | ✅ 对齐；`jarvis-agent` 为瘦壳 |
| Renderer 只导入 `@jarvis/core/renderer` | ✅ 未发现 full-barrel 违规 |
| API Key 不明文落盘 | ⚠️ 搜索密钥迁移已存在；`config.import` 仍可写入明文/任意 settings |
| Provider/model ID 用户定义 | ❌ `dall-e-3` 等硬编码仍在图像路径 |
| tasks 单写者（daemon） | ❌ Electron main 仍直接写 `tasks` 等表 |
| IPC `{ok,error}` 值形返回 | ⚠️ 部分 handler 仍 throw |
| 1.0.0-Preview 能力闭环 | ❌ MCP SSE/HTTP、D9 transcript、Canvas 路由、VersionHistory 挂载、Provider 指南等未闭环 |

---

## 2. 总体概览

### 2.1 相对 2026-08-06 的变化

**已改善（Partial/Fixed 趋势）：**

1. `TrustedRendererPolicy` + `installNavigationGuards` 已接入主窗口（SEC-01 部分止血）。
2. `IpcRouter` 校验可信窗口/frame/origin；preload allowlist 仍排除 `secrets.*`。
3. `PathCapabilityStore` 已存在，Office/Workspace 部分路径已走 capability（SEC-02 部分）。
4. `SafeUrlPolicy` / `SafeHttpClient` 已实现并用于 provider 保存校验、搜索、Skill URL 导入。
5. `SearchSecretMigration` 启动时迁移搜索明文密钥（SEC-07 部分）。
6. Plugin 已迁到 `utilityProcess` 宿主（SEC-08 方向正确，仍需加固）。
7. UI 设计系统 `@jarvis/ui` 已真实落地（非脚手架）；`packages/views` 仍为脚手架。

**仍阻断发布：**

1. `xlsx@0.18.5` 仍在 main 进程解析路径（SEC-03）。
2. Provider 运行时请求绕过 `SafeUrlPolicy`；`config.import` 可注入私网 baseUrl / 明文 settings（SEC-05 回归 + SEC-NEW-11）。
3. `run_shell "git commit"` 绕过 `git_commit` 审批 → git hooks 任意代码执行（SEC-NEW-10）。
4. Anthropic `tool_use` / structured tool turn 未完成（REQ-06 / BP-06）。
5. Pause 仅改状态，无协作式 barrier（BP-01）。
6. 无 `.github` CI；S2 E2E 仍为恒真占位；缺 lint/coverage/audit 门禁。
7. 产品能力：D9、远程 MCP、Canvas `:taskId`、VersionHistory UI、provider-guide 未闭环。

### 2.2 风险统计（本报告）

| 等级 | 数量 | 说明 |
|---|---:|---|
| Critical / 高 | 14 | 安全可达路径、协议失效、高危依赖、用户安全控制失真 |
| 中 | 24 | 架构漂移、资源泄漏、需求未闭环、可靠性 |
| 低 | 10 | 规范、注释、防御纵深、一致性 |
| **合计唯一问题** | **48** | 保留原 44 ID 追踪键 + 4 个新增（SEC-NEW-10..13）；原 ID 状态见矩阵 |

整体风险：**高**。发布建议：**否**。

---

## 3. CR 状态矩阵（AI 追踪主表）

> **用法**：自动化 Agent 必须以 `CR-ID` 为唯一键；只处理 `Status ∈ {Open, Partial}`；`Plan`/`TaskHint` 指向已有 implementation plan；完成后更新本矩阵并附验证命令证据。不得以“模块存在”标记 Fixed。

状态枚举：`Open` | `Partial` | `Fixed` | `ExternalBlocked`

### 3.1 需求闭环 REQ

| ID | Sev | Status | 证据（2026-08-07） | Plan | AI TaskHint |
|---|---|---|---|---|---|
| REQ-01 | 高 | Open | `office.ts` `getTranscript()` 仍返回 `undefined` | `cr-office-content` | 实现 transcript API + 字幕/文本回退；稳定错误码 |
| REQ-02 | 高 | Open | MCP 仅 stdio；UI 硬编码 `transport:'stdio'`；无 http-transport | `cr-v1-product-closure` Task1 | SSE + Streamable HTTP + SafeHttpClient |
| REQ-03 | 中 | Partial | URL Skill IPC 已有；需确认 UI/冲突策略/名称校验完整 | `cr-v1-product-closure` Task3 | 补 UI 闭环与回归 |
| REQ-04 | 中 | Open | `docs/provider-guide.md` 不存在 | `cr-v1-product-closure` Task4 | 恢复文档 + `scripts/docs-links.mjs` |
| REQ-05 | 中 | Open | `office/image.ts` 默认 `dall-e-3` + OpenAI URL | `cr-office-content` | 删除硬编码；用户 Provider/Model + SecureStorage |
| REQ-06 | 高 | Open | Anthropic adapter 未处理 `tool_use`/`input_json_delta` | `cr-engine-tool-mcp` | structured tool turn + Anthropic streaming |
| REQ-07 | 中 | Open | `App.tsx` 仅 `/canvas`；无 `/canvas/:taskId` | `cr-v1-product-closure` Task5 | 路由 + active task 解析 |
| REQ-08 | 中 | Open | `AgentDetailPage` 未挂载 VersionHistory | `cr-v1-product-closure` Task6 | 挂载并 rollback 后刷新 |

### 3.2 安全 SEC

| ID | Sev | Status | 证据 | Plan | AI TaskHint |
|---|---|---|---|---|---|
| SEC-01 | 高 | Partial | Navigation guards + TrustedRendererPolicy 已接入；需持续回归 | `cr-security-trust-boundary` | 补 E2E：远程导航不得暴露 IPC |
| SEC-02 | 高 | Partial | PathCapabilityStore 存在；确认所有文件 IPC 无裸路径 | 同上 | 审计全部 file IPC，拒绝裸绝对路径 |
| SEC-03 | 高 | Open | `xlsx@0.18.5` + main 内解析无上限 | `cr-office-content` | 移除 xlsx；utilityProcess + 限额 |
| SEC-04 | 中 | Partial | Skills 有 URL 导入与名称约束；需路径逃逸全覆盖 | `cr-security-trust-boundary` | `../`、symlink、绝对路径测试 |
| SEC-05 | 高 | Partial | SafeUrlPolicy 存在，但 **model adapter / image / video 用 raw fetch** | 同上 | 注入 SafeHttpClient 到 adapters |
| SEC-06 | 中 | Open | macOS SecureStorage 任意失败映射为 null | `cr-quality-gates` | 仅 item-not-found→null，其余可诊断失败 |
| SEC-07 | 高 | Partial | SearchSecretMigration 已接线；import 可再引入明文 | `cr-security-trust-boundary` | import 走 redact/迁移；禁止明文 apiKey |
| SEC-08 | 高 | Partial | utilityProcess 宿主存在；child 仍 `vm.Script` | 同上 | 强化隔离/超时/权限；禁主进程 VM |
| SEC-09 | 中 | Partial | Multica 策略/审批存在；auth 比较不一致；injection 生产空 | 同上 + daemon plan | constant-time；真实 local injection |
| SEC-NEW-10 | 高 | Open | `run_shell` + whitelist `git commit` 绕过审批 | （并入 security plan） | 审批看命令内容；默认禁 hooks |
| SEC-NEW-11 | 高 | Open | `config.import` 不校验 baseUrl、无 settings allowlist | （并入 security） | assertAllowedUrl + EXPORT_ALLOWED keys |
| SEC-NEW-12 | 中 | Open | darwin `security -w value` 经 argv 传密钥 | （并入 security） | 优先 Electron safeStorage |
| SEC-NEW-13 | 低 | Open | `secrets.*` main 注册，仅 preload 挡住 | （并入 security） | main 侧拒绝或取消注册 |

### 3.3 最佳实践 BP

| ID | Sev | Status | 证据 | Plan | AI TaskHint |
|---|---|---|---|---|---|
| BP-01 | 高 | Open | `TaskOrchestrator.pause()` 只改状态 | `cr-task-daemon-lifecycle` Task1 | `CooperativeRunControl` + engine barrier |
| BP-02 | 中 | Partial | Chat 走 ModelRouter；Task/Office 路径不完全统一 | `cr-engine-tool-mcp` | 统一重试/fallback/超时/取消 |
| BP-03 | 中 | Open | fallback chain 未完整贯穿 EngineRunInput | 同上 | 不可变 run input 含 fallback |
| BP-04 | 高 | Open | McpClient 无 timeout；transport 无 exit/error 清理 | 同上 | pending finish/failAll + 帧上限 |
| BP-05 | 高 | Open | `AgentEngine.visibleTools` 可变共享状态 | 同上 | 改为 `EngineRunInput` 作用域 |
| BP-06 | 高 | Open | tool 结果无 toolCallId；消息模型缺 toolCalls | 同上 | provider-neutral structured turns |
| BP-07 | 中 | Open | `task-store` 全局 `status/logs`，非按 taskId | `cr-task-daemon-lifecycle` | Map by taskId；拒绝陈旧事件 |

### 3.4 性能 PERF

| ID | Sev | Status | Plan | AI TaskHint |
|---|---|---|---|---|
| PERF-01 | 中 | Open | `cr-task-daemon-lifecycle` | 终态回收 controllers/inputs/logs；LRU/DB 重建 |
| PERF-02 | 中 | Open | `cr-office-content` | 隔离解析 + 限额；禁全量 Base64 IPC |
| PERF-03 | 中 | Open | `cr-performance-release` | 复用 WebView session + 清理 |
| PERF-04 | 中 | Open | 同上 | bundle budget + 冷启动/daemon ready CI |

### 3.5 可维护性 MAINT

| ID | Sev | Status | Plan | AI TaskHint |
|---|---|---|---|---|
| MAINT-01 | 高 | Open | `cr-task-daemon-lifecycle` | daemon 成为 tasks 唯一写者；main 经认证 API |
| MAINT-02 | 中 | Open | 同上 | DaemonSupervisor generation 隔离旧回调 |
| MAINT-03 | 中 | Open | 同上 | ApprovalCenter 终态清理 timer |
| MAINT-04 | 中 | Open | 同上 | busy = active task count |
| MAINT-05 | 中 | Open | 同上 | 生产接线真实 local injection |
| MAINT-06 | 中 | Open | 同上 | Multica registration 统一加锁 |

### 3.6 规范 / 文档 / 测试

| ID | Sev | Status | Plan | AI TaskHint |
|---|---|---|---|---|
| STD-01 | 中 | Open | `cr-quality-gates` | ESLint/Prettier/lint/coverage/CI |
| STD-02 | 低 | Partial | 同上 | IPC 全收敛到 IpcChannel 常量 |
| STD-03 | 低 | Open | 同上 | 移除 `@tanstack/react-router` 死依赖 |
| STD-04 | 低 | Open | `cr-office-content` | main 稳定错误码 + i18n |
| STD-05 | 中 | Open | 同上 | 删除硬编码模型 ID |
| DOC-01 | 低 | Open | `cr-quality-gates` | AgentEngine 过时注释等 |
| TEST-01 | 高 | Open | 同上 | typecheck 绿；ABI 隔离 |
| TEST-02 | 中 | Open | 同上 | coverage 阈值 |
| TEST-03 | 高 | Open | 同上 | 替换 S2 恒真；补 S1–S6 |
| TEST-04 | 中 | Open | 同上 | Node Vitest vs Electron E2E ABI 隔离 |

---

## 4. 分维度评审

### 4.1 技术方案

**优点**

- 五层架构清晰；引擎所有权（决策 A）正确，避免 Go/TS 双实现。
- `@jarvis/core` vs `@jarvis/core/renderer` 双入口设计合理。
- protocol 包独立、preload allowlist、值形 IPC 方向正确。
- SQLite migration 有序版本化；SecureStorage + apiKeyRef 模式正确。

**问题**

1. **双写者漂移**：文档要求 daemon 拥有 tasks/squads/audit/token_usage；main 仍大量写入 → 状态机不变量难执行（MAINT-01）。
2. **信任边界半完工**：保存时校验 URL、请求时 raw fetch → TOCTOU/重定向 SSRF（SEC-05）。
3. **产品声明超前实现**：Pause、远程 MCP、D9、Canvas 深链等 UI/文档宣称与主路径不一致。

### 4.2 代码结构

- `packages/core` 模块划分合理（agent/model/mcp/sandbox/task/office…）。
- Desktop main IPC 按域拆分，但 `office.ts` / `tasks.ts` 职责过重，安全策略分散。
- `packages/ui` 已是真实组件库；`packages/views` 仍脚手架，CLAUDE.md 表述需更新以免误导。
- 既有 7 份 CR plan 任务 checkbox **全部未勾选**，设计完备但实施滞后。

### 4.3 编码规范

- i18n 对称门禁存在且通过；但 main 仍有硬编码中文错误（STD-04）。
- 缺 ESLint/Prettier/CI（STD-01）。
- IPC 字符串与常量混用（STD-02）。
- 过时注释（DOC-01：`AgentEngine` 仍称 ChatRequest 无 tools，实际已注入）。

### 4.4 代码合理性

- `pause` 不暂停副作用 → 用户控制失真（BP-01）。
- 共享 `visibleTools` → 并发任务工具集串扰（BP-05）。
- MCP 请求可永久挂起（BP-04）。
- Anthropic 工具流不可用 → REACT 在 Anthropic Provider 上实质失败（REQ-06）。

### 4.5 扩展性

- ToolRegistry 全局可变视图阻碍多 Agent/Plan/MCP 隔离（BP-05）。
- MCP transport 契约未抽象到 SSE/HTTP（REQ-02）。
- ModelRouter 未成为唯一出口（BP-02）。
- 硬编码模型破坏多 Provider 扩展（STD-05/REQ-05）。

### 4.6 健壮性

- 任务终态 Map 泄漏（PERF-01）。
- Daemon queue 无 panic recover（新发现，并入 MAINT/可靠性）。
- Claim ACK 在持久化前（任务丢失风险）。
- 并发配置可为 0/负 → 队列永久停滞。
- Migration 非事务包裹多语句破坏性变更。
- WebView 仅校验初始 URL，重定向可逃逸到私网（SEC-05 扩展）。

### 4.7 软件安全性（摘要）

已正确：

- BrowserWindow：`contextIsolation` / `nodeIntegration:false` / `sandbox:true`。
- Navigation deny + 外链系统浏览器。
- IPC trusted origin/frame。
- Path capability（部分）。
- SafeUrlPolicy 核心实现质量高（HTTPS、DNS、私网、重定向、大小）。
- Markdown 无 `rehype-raw`；无 `dangerouslySetInnerHTML`。
- `run_shell` 使用 `execFile`（非 shell 解释），元字符相对安全。
- Daemon 绑定 `127.0.0.1` + Bearer。

高优先级缺口见 SEC-* / SEC-NEW-*。

### 4.8 测试方案

| 区域 | 规模（约） | 评价 |
|---|---:|---|
| packages/core | 73 spec | 纯逻辑较充足；缺 pause/tool-turn/MCP lifecycle |
| apps/desktop main | 43 | 安全原语有测；缺 import SSRF、WebView redirect |
| apps/desktop renderer | 66 | UI 多；store 多任务乱序不足 |
| daemon Go | 21 | race 有基础；缺 panic recover / claim 持久化 |
| desktop e2e | 4 | S2 恒真占位 |
| test/1.0.0-Preview | 13 suites | 有真实旅程但大量 skip |
| CI | 0 | 无 `.github` |

缺失用例优先清单见第 6 节。

---

## 5. 新增高优先级发现（详细）

### SEC-NEW-10【高】`run_shell "git commit"` 绕过审批 → hooks RCE

- **位置**：`task-engine-factory.ts` 审批特例仅 `git_commit`；`Sandbox.ts` whitelist 含 `git commit`；`ApprovalGate` 默认 allow `run_shell`。
- **攻击**：Prompt injection / 恶意仓库 → `run_shell` 执行 `git commit` → `.git/hooks/*` 在沙箱外执行。
- **修复**：
  1. `run_shell` 解析 base command，对 `git (add|commit|push|reset|checkout|clean|rebase|merge)` 强制审批或拒绝。
  2. 默认 `git -c core.hooksPath=/dev/null`（或等价）除非用户显式批准 hooks。
  3. 测试：`run_shell git commit` 必须触发 `approval.request`。

### SEC-NEW-11【高】`config.import` 绕过 URL 策略与密钥红线

- **位置**：`apps/desktop/src/main/ipc/config.ts:84-122`
- **攻击**：恶意配置导入私网 `baseUrl` 或明文 `search_providers.apiKey`。
- **修复**：导入前 `assertAllowedUrl`；settings 仅允许 `EXPORT_ALLOWED_SETTINGS_KEYS`；明文密钥迁移或拒绝。

### SEC-05 回归【高】Model adapter 运行时 SSRF

- **位置**：`openai.ts`/`anthropic.ts` raw `fetch`；`task-engine-factory`/`chat`/`office` 未注入 SafeHttpClient。
- **修复**：`requestStream` + 每跳校验；三处接线；重定向到 link-local 必须失败。

### SEC-03【高】Office 解析在 main + xlsx 高危

- **位置**：`apps/desktop/package.json` `xlsx@^0.18.5`；`office.ts` analyze。
- **修复**：按 `cr-office-content` 移除 xlsx，utilityProcess + 资源限额。

### BP-01 / BP-05 / BP-06 / REQ-06【高】引擎正确性簇

必须按 `cr-engine-tool-mcp` + `cr-task-daemon-lifecycle` Task1 顺序：structured tool turn → Anthropic tool_use → run-scoped tools → CooperativeRunControl。

---

## 6. AI 自动整改操作手册

### 6.1 全局约束（任何 Agent 不得违反）

1. Engine/REACT/ModelRouter/MCPClient 只在 `packages/core` TS。
2. Renderer 只从 `@jarvis/core/renderer` 导入。
3. `packages/protocol` 不依赖 `@jarvis/core`。
4. 禁止硬编码模型 ID；禁止 API Key 明文落盘。
5. Migration 只追加 v13+，不改 v1–v12。
6. 新 UI/错误码 zh-CN/en 对称；提交前 `pnpm i18n:check`。
7. TDD：先写失败测试 → 实现 → 重构；一 Task 一 commit（`feat:`/`fix:`/`test:`…）。
8. 不引入 Preview 排除项：本地模型、离线模式、云同步、自动更新、全局快捷键、Monaco。

### 6.2 推荐执行波次（严格顺序）

```text
Wave 0 安全止血
  SEC-NEW-10 → SEC-NEW-11 → SEC-05(adapters) → SEC-03 → SEC-07(import) → SEC-06 → SEC-NEW-12 → SEC-02审计 → SEC-NEW-13
Wave 1 引擎正确性
  BP-06 → REQ-06 → BP-05 → BP-04 → BP-02/03 → BP-01 → BP-07
Wave 2 产品闭环
  REQ-02 → REQ-01 → REQ-05/STD-05 → REQ-07 → REQ-08 → REQ-03 → REQ-04
Wave 3 生命周期与架构
  MAINT-01..06 → PERF-01 → PERF-02/03
Wave 4 质量与发布
  STD-01/02/03 → TEST-01..04 → PERF-04 → 全量复审矩阵
```

每波次对应已有 plan 文件：

| Wave | Primary plans |
|---|---|
| 0 | `docs/superpowers/plans/2026-08-06-cr-security-trust-boundary.md` + 本报告 SEC-NEW |
| 1 | `.../2026-08-06-cr-engine-tool-mcp.md` + `.../cr-task-daemon-lifecycle.md`（Task1 先） |
| 2 | `.../2026-08-06-cr-v1-product-closure.md` + `.../cr-office-content.md` |
| 3 | `.../cr-task-daemon-lifecycle.md` + `.../cr-office-content.md` + `.../cr-performance-release.md` |
| 4 | `.../cr-quality-gates.md` + `.../cr-performance-release.md` |

### 6.3 单 CR 执行模板（Agent 必须按此输出）

```md
## Implementing {CR-ID}
StatusBefore: Open|Partial
PlanRef: docs/superpowers/plans/...
Files:
- Create/Modify: ...
Red tests: (commands + expected FAIL reason)
Green implementation: (interfaces)
Validation:
- pnpm ...
- expected PASS evidence
Commit: fix({scope}): {CR-ID} ...
StatusAfter: Fixed
Evidence: 测试输出摘要 / 文件行号
```

### 6.4 关键 Red 测试清单（优先编写）

1. `ApprovalGate`/`task-engine-factory`：`run_shell` + `git commit -m x` → 需审批（SEC-NEW-10）。
2. `config.import`：私网 baseUrl 拒绝；settings 含 `apiKey` 不得写入 SQLite（SEC-NEW-11/SEC-07）。
3. adapters：302→`169.254.169.254` 抛 `URL_PRIVATE_ADDRESS`（SEC-05）。
4. Anthropic SSE：`tool_use` + `input_json_delta` 产出带 id 的 toolCalls；第二轮带 `tool_result`（REQ-06/BP-06）。
5. 两并发 `AgentEngine.run` 不同 visibleTools 互不污染（BP-05）。
6. `CooperativeRunControl`：pause 后无模型/工具副作用（BP-01）。
7. McpClient：timeout / child exit → pending 全失败（BP-04）。
8. Office：zip bomb / 超大文件 → timeout 或拒绝，main 不 OOM（SEC-03/PERF-02）。
9. Renderer task-store：taskA 事件不得覆盖 taskB（BP-07）。
10. 替换 `e2e/s2-file-shell.spec.ts` 恒真为 mock Provider 文件+Shell 旅程（TEST-03）。

### 6.5 验证命令门禁（Fixed 判定最低标准）

```bash
pnpm i18n:check
pnpm typecheck
pnpm --dir packages/core vitest run
pnpm --dir apps/desktop vitest run   # Node ABI 重建后
cd daemon && go test -race ./...
pnpm --dir apps/desktop e2e
# Wave4+
pnpm lint && pnpm audit --prod
```

任一命令失败 → 对应 CR 不得标 Fixed。

### 6.6 完成定义（DoD）

1. 本报告矩阵中该 CR-ID → `Fixed`。
2. 对应 plan checkbox 勾选，并附 commit hash。
3. 有失败→通过的测试证据。
4. 不破坏第 6.1 全局约束。
5. 全量复审时，原攻击场景不可再复现。

---

## 7. 单元 / 集成 / E2E 专项建议

### 7.1 覆盖率目标（Wave 4）

| 层 | 行覆盖目标 | 优先模块 |
|---|---:|---|
| packages/core | ≥80% | AgentEngine, TaskOrchestrator, adapters, McpClient, Sandbox, ApprovalGate |
| desktop main security | ≥90% | TrustedRendererPolicy, SafeUrlPolicy, PathCapabilityStore, config import |
| daemon runtime/httpapi | ≥70% + race | queue, auth, taskstore, multica policy |
| renderer stores | ≥70% | task-store, ipc-subscriptions |

### 7.2 ABI / CI 隔离（TEST-04）

- Job A：Node ABI → desktop unit（rebuild better-sqlite3 for Node）。
- Job B：Electron ABI → e2e（rebuild for Electron）。
- 禁止同一 job 混跑导致 `node_modules` 污染。

### 7.3 S1–S6 真实旅程

| 旅程 | 最低断言 |
|---|---|
| S1 Onboarding | Provider+Agent 可保存；密钥不进 DB 明文 |
| S2 文件+Shell | mock model 触发 write_file/run_shell；审批路径可测 |
| S3 Office | 小样例解析成功；恶意样例被拒 |
| S4 Diff Accept | coding diff 接受写入工作区 |
| S5 Squad | Leader 委派时间线事件 |
| S6 Multica | 注册/心跳/claim 本地 mock |

---

## 8. 验证记录（本复审环境）

| 检查 | 结果 |
|---|---|
| 源码静态复验（并行 Agent + 人工抽检） | 完成；关键 Open 项均有文件证据 |
| `pnpm i18n:check` | 通过（历史记录；本环境依赖未装齐时以脚本存在为准） |
| `pnpm typecheck` / `pnpm test` | 本 Cloud 环境缺 `node_modules`/turbo，未作为发布证据；以代码态为准 |
| `.github/` CI | **不存在** |
| `docs/provider-guide.md` | **不存在** |
| `xlsx` 依赖 | **仍在** `apps/desktop/package.json` |
| CR plan checkboxes | **0 勾选**（7 份计划均未实施完成） |
| 相对 08-06 安全原语 | TrustedRenderer / PathCapability / SafeUrlPolicy / SearchSecretMigration / PluginRunnerHost **已出现** |

---

## 9. 总结与发布裁决

### 9.1 结论

JARVIS 架构方向与大量 core 单测基础良好，且 08-06 后已补上关键信任边界原语；但 **1.0.0-Preview 仍未达到冻结发布条件**。最大阻断簇是：

1. 安全：Office 高危解析、运行时 SSRF、git hooks 审批绕过、config import 污染。
2. 正确性：工具协议 / Anthropic / Pause / 共享工具可见性。
3. 产品：远程 MCP、D9、Canvas、VersionHistory、Provider 文档。
4. 工程：无 CI、E2E 占位、ABI 测试污染风险、tasks 双写。

### 9.2 是否可以合入/发布

**否。**

合入前至少 Fixed：`SEC-NEW-10`、`SEC-NEW-11`、`SEC-05(adapters)`、`SEC-03`、`BP-06`、`REQ-06`、`BP-01`、`BP-05`、`TEST-01`、`TEST-03`。其余 Open 项按 Wave 推进；若产品决定降级某 REQ，必须同步 Wiki/UI/发布说明，不得保留“已实现”文案。

### 9.3 给自动化 Agent 的一句话指令

> 以本报告第 3 节矩阵为唯一 backlog，按第 6.2 Wave 顺序读取对应 `docs/superpowers/plans/2026-08-06-cr-*.md` Task，严格 TDD 与第 6.1 约束，每完成一 CR 按第 6.3 模板提交并更新矩阵状态。

---

本报告针对 2026-08-07 基线 `b30219e` 生成。后续每次整改波次结束后应追加「整改矩阵」章节（CR-ID → commit → 验证命令 → Fixed），不得在无证据时改写历史结论。
