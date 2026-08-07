# JARVIS Code Review 报告

## 1. 基本信息

| 项目 | 内容 |
|---|---|
| 项目名称 | JARVIS 1.0.0-Preview（本地优先桌面 AI Agent 平台） |
| 评审日期 | 2026-08-07 |
| 评审范围 | `packages/core`、`packages/protocol`、`packages/ui`、`packages/i18n`、`apps/desktop`（main/preload/renderer）、`daemon/`、根构建/测试脚本、`test/1.0.0-Preview`、依赖与打包配置 |
| 代码基线 | `master` / 工作树 HEAD（含 UI polish 等近期合入） |
| 技术栈 | Electron 32、React 19、TypeScript 5、Zustand、react-i18next、better-sqlite3、Go、SQLite、pnpm/Turborepo、Vitest、Playwright |
| 评审方式 | **独立全仓静态+调用链审查**；结论仅依据源码、构建配置与可执行验证，不继承既有质量报告的问题编号或整改矩阵 |
| 评审维度 | 业务契合、技术方案、代码结构、编码规范、合理性、扩展性、健壮性、软件安全、测试方案 |
| 结论 | **当前不建议作为 1.0.0-Preview 发布**；架构方向正确，但引擎工具协议、审批默认放行、打包 Daemon 不可达、无 CI、生产构建失败等构成发布阻断 |

---

## 1.1 业务背景与目标（评审基线）

JARVIS 面向个人办公，把对话、REACT 任务、编程辅助、办公增强、多 Agent（Squad）与可选 Multica 运行时收进一个 Electron 应用：

- **本地优先**：数据在 `~/.jarvis/jarvis.db`；无遥测、无云同步；API Key 走系统安全存储。
- **引擎一次实现**：`AgentEngine` / ModelRouter / MCP / 工具链只在 TypeScript `packages/core`；Go 仅为调度与协议壳。
- **可配置 Provider**：OpenAI 兼容 / Anthropic 兼容；模型 ID 用户定义，禁止硬编码。
- **安全卖点**：沙箱、审批门、路径能力、本机 Daemon。
- **交付目标（Preview）**：zh-CN/en 对称、S 系列主旅程可用、冷启动与 Daemon 就绪可接受、可安装包可启动完整能力。

本报告以「上述承诺在源码中是否真实成立」为唯一评判标准。

---

## 2. 总体判断

### 2.1 做得好的地方（应在整改中保护）

1. **五层架构清晰**：SQLite → Go daemon → Electron main → `packages/core` → Renderer；职责边界大体正确。
2. **渲染进程隔离到位**：`contextIsolation` / `nodeIntegration:false` / `sandbox:true`；preload allowlist；`TrustedRendererPolicy` 校验 sender/frame/origin；默认拒绝应用内导航。
3. **路径能力与 SSRF 原语质量高**：`PathCapabilityStore`（token/TTL/realpath）；`SafeUrlPolicy`（HTTPS、DNS 钉扎、私网拒绝、重定向复检、体积上限）。
4. **密钥迁移认真**：`SearchSecretMigration` 写回校验、`secure_delete`、扫描 DB/WAL 明文；Provider 表存 `api_key_ref`。
5. **Core 可测性强**：广泛依赖注入（fetch/exec/fs/spawn）；`packages/core` 约 73 个 spec / 261 测试可直接跑绿。
6. **Daemon 策略层设计用心**：MCP 绝对路径、摘要审批、危险环境变量拒绝；loopback 绑定；部分路径 Bearer。
7. **Markdown XSS 面可控**：`react-markdown` 无 raw HTML；链接限制 `https:`。

### 2.2 发布阻断级问题（摘要）

| 阻断簇 | 代表 ID | 一句话 |
|---|---|---|
| REACT 工具协议不可用 | CORE-01, CORE-02 | 消息模型无法表达 tool call；Anthropic 从不产出 tool_call |
| 审批默认放行 | DESK-01, CORE-11 | `write_file` / 多数 `run_shell` 无提示即执行 |
| 设置通道可关沙箱 | DESK-02 | `settings.set` 无 schema → 可把 agent 升到 `system` |
| 打包 Daemon 不可执行 | BUILD-02, BUILD-04, DAEM-01 | asar 内二进制、Windows 缺 `.exe`、无 `headless.mjs` |
| 质量门红 / 无 CI | TEST-01, BUILD-01 | `pnpm test` 因 Markdown 导入构建失败；无 `.github` |
| 暂停是假的 | CORE-22 | `pause` 只改状态，模型与工具继续跑 |

### 2.3 统计

| 严重度 | 数量 |
|---|---:|
| Critical | 8 |
| High | 28 |
| Medium | 24 |
| Low | 10 |
| **合计** | **70** |

编号前缀：`CORE`（引擎）、`DESK`（桌面）、`DAEM`（Daemon）、`TEST`（测试）、`BUILD`（构建/依赖/发布）。

---

## 3. 分维度评审

### 3.1 技术方案

**契合点**：决策 A（引擎只在 TS）在代码纪律上被遵守——Go 未重写 REACT；双入口 `@jarvis/core` / `@jarvis/core/renderer` 设计正确。

**偏离点**：

1. **任务路径绕过 ModelRouter**（CORE-04）：超时/重试/fallback/熔断只服务聊天，长任务反而裸调 adapter。
2. **SafeHttpClient 在 core 仅有接口**：最高频出站（模型）走全局 `fetch`（CORE-18）。
3. **Multica 半成品**：大量 Go 代码在产品路径上因未注入 `JARVIS_MULTICA_SERVER` 而不可达（DAEM-16）；本地任务仍由 Electron main 直接写 `tasks`。
4. **声明的能力超前实现**：Pause、代理设置、Plugin 加载、远程 MCP 在 UI/接口层存在，主路径未闭环。

### 3.2 代码结构

- `packages/core` 模块划分合理；问题在于**共享可变单例**承载本应 per-run 的状态（`visibleTools`、squadCtx、全局 ToolRegistry）。
- Desktop `IpcRouter.registerAll` 过大；另有三套**未引用的死 IPC 注册模块**仍使用裸路径契约（DESK-07）——误接会撤销能力模型。
- `packages/ui` 已是真实组件库；`packages/views` 仍脚手架。
- Daemon 与 Electron **双开 SQLite**、无 busy_timeout（DAEM-11）。

### 3.3 编码规范

- `pnpm i18n:check` 键对称通过，但 main 仍硬编码中文错误文案（DESK-19）；检查脚本不扫源码字面量。
- **无 ESLint/Prettier/golangci**（BUILD-07）。
- **typecheck 失败**（DESK-08）：重复 import、错误的 highlighter 命名导入等。
- IPC `{ok,error}` 约定未结构性强制（DESK-15）。
- 注释有时描述过时不变量（CORE-29）。

### 3.4 代码合理性

- Pause/Resume 语义与用户预期不符（CORE-22）。
- `ok: !stderr` 把 git 正常 stderr 当失败（CORE-23）。
- git 工具 schema 为空却读取 `message`/`path`（CORE-13）。
- Token usage 逐步覆盖而非累加（CORE-05）。
- 工具抛错直接打挂整任务，而非回灌模型（CORE-06）。
- 代理配置可存可导，但从不应用到 fetch（CORE-28）。

### 3.5 扩展性

- ToolRegistry 无命名空间冲突保护 → 插件可影子内置工具（CORE-07）。
- MCP 按 server 名缓存后，绑定关系不按 agent 过滤可见工具（CORE-20）。
- 缺 run-scoped 授权视图；Plan-only 与可见工具半迁移。
- PluginHost 有 load 无 unload（CORE-27）。

### 3.6 健壮性

- MCP 无请求超时、exit 不清理 pending；stdio `error` 可打崩 main；stderr 不读可死锁（CORE-08/09）。
- SSE reader 提前 break 泄漏（CORE-16）；ModelRouter 整段超时、无退避、重试重复 delta（CORE-17）。
- 任务 Map / WebView partition / capability 记录无终态回收（DESK-20）。
- Daemon：claim 先 ACK 后内存队列（DAEM-02）；job panic 杀进程（DAEM-04）；关机取消结果上报（DAEM-03）。
- 迁移非事务包裹（DESK-11）；bootstrap 无 catch（DESK-03）。

### 3.7 软件安全性

**强项见 §2.1。**

**关键缺口**：

| ID | 风险 |
|---|---|
| DESK-01 / CORE-11 | 审批默认 allow；写文件/多数 shell 无提示 |
| DESK-02 | `settings.set` 可关沙箱 |
| CORE-18 | 模型请求绕过 SSRF 策略 |
| DESK-05 | IdeBridge `:17891` 无认证 HTTP |
| DESK-12 | `mcp.create`+`test` = 任意进程 spawn |
| BUILD-05/06 | Electron 32 EOL；`xlsx@0.18.5` 高危可达 |
| DESK-04 | macOS keychain 经 argv 传密钥 |
| DESK-10 | WebView 策略可 fail-open；无导航守卫 |
| DAEM-08 | Multica 出站无凭证、可 http、路径未 escape |
| CORE-25 | Skill/Memory 描述注入系统提示 |

### 3.8 测试方案

- 单测体积可观（约 760 Vitest + 20 Go），但 **协议/安全主路径大量用 fake**，绿测不证明 Provider 真能跑通工具环（CORE-26）。
- `pnpm test` **依赖 build 且 build 红** → 最大桌面套件被跳过（TEST-01）。
- 功能回归大量 `test.skip(true)` 在失败条件上自跳过（TEST-02）；`test:functional --pass-with-no-tests`（TEST-03）。
- S2 e2e 存在 `expect(true).toBe(true)`。
- 无 CI（BUILD-01）；Go 测试不在根脚本聚合（TEST-05）。
- 打包 `file://` + `BrowserRouter` 组合未被 e2e 覆盖（DESK-06）。

---

## 4. 问题清单（AI 可执行）

> 每个 ID 是唯一追踪键。Agent 必须：写失败测试 → 实现 → 跑验证命令 → 一 commit → 将状态改为 Fixed。不得以「模块存在」结案。

### 4.1 Critical

#### CORE-01 · Critical · tech_solution
**工具往返在消息模型中不可表达，真实 Provider 上第二步请求必然畸形**

- **证据**：`packages/core/src/model/types.ts`（`ModelMessage` 无 toolCalls/toolCallId）；`AgentEngine.ts` 推送 `{role:'tool', content}` 且仅在有 text 时推 assistant。
- **影响**：OpenAI 兼容端拒绝缺 `tool_call_id` 的 tool 消息；Anthropic 不接受 `role:tool`。本地 Agent「用工具再推理」主价值在真实 Provider 上不可用。
- **AI_FIX**：
  1. 将 `ModelMessage` 改为可表达 assistant.`toolCalls` 与 tool.`toolCallId` 的联合类型。
  2. Engine：无论 text 是否为空，先推带 toolCalls 的 assistant，再推带 id 的 tool 结果。
  3. OpenAI/Anthropic adapter 按各自协议序列化。
  4. 测试：断言第二轮 `fetch` body 含正确关联；禁止仅测 fake chat。
  5. 验证：`cd packages/core && pnpm vitest run src/model src/agent && pnpm typecheck`

#### CORE-02 · Critical · tech_solution
**Anthropic adapter 发送 tools 但从不解析 tool_use**

- **证据**：`anthropic.ts` 请求含 tools；SSE 循环只处理 text_delta / usage / stop。
- **影响**：Anthropic 路径静默退化为单轮聊天。
- **AI_FIX**：处理 `content_block_start(tool_use)`、`input_json_delta`、`content_block_stop`，发出 `tool_call` chunk。依赖 CORE-01。验证同上。

#### DESK-01 · Critical · security
**审批门默认 allow；write_file / 多数 run_shell 无用户确认**

- **证据**：`ApprovalGate.evaluate` 末尾 `return 'allow'`；`task-engine-factory.ts` 对 allow 且非 `git_commit` 直接 `return true`。
- **影响**：产品宣称的审批安全名存实亡；Agent 可静默改文件、跑大量 shell。
- **AI_FIX**：默认改为需审批（`ask`）；仅 `allowAlways` 自动放行；扩展敏感命令；为 `write_file`/`run_shell` 写「必须走到 ApprovalCenter」测试。

#### DESK-02 · Critical · security
**`settings.set` 无校验 → 可把沙箱升到 `system`**

- **证据**：`IpcRouter` 注册 `settings.set` 原样写入；`tasks.ts` 读 `permissions.${agentId}.level`；`Sandbox` 在 `system` 级跳过命令/URL 检查。
- **AI_FIX**：settings 键 schema；未知键拒绝；`level:'system'` 需显式确认；`config.import` 共用同一 schema。

#### DAEM-01 · Critical · tech_solution
**Go agent 依赖的 `packages/core/dist/headless.mjs` 不存在**

- **证据**：`daemon/cmd/jarvis-agent/run.go` 默认 `packages/core/dist/headless.mjs`；core 无 build/dist。
- **影响**：决策 A 的 Go→Node 桥断裂；Multica 执行路径无法驱动同一引擎。
- **AI_FIX**：core 增加 headless 构建产物；Supervisor 注入绝对 `JARVIS_CORE_ENTRY`；缺省时 fail-loud。

#### DAEM-02 · Critical · robustness
**Claim 先 ACK、任务只在内存队列**

- **证据**：`handler.go` 先 `Ack(true)` 再 `Queue.Submit`；Queue 无持久化。
- **AI_FIX**：先落库再 ACK；ACK 失败则丢弃；启动恢复 queued/running。

#### TEST-01 · Critical · testing
**`pnpm test` 因桌面 build 失败整体红，467 个桌面测试被跳过**

- **证据**：`MarkdownView.tsx` 对 CJS 样式使用命名导入 `{ oneDark }`；turbo `test` dependsOn `build`。
- **AI_FIX**：改为 default import；turbo 改为 `^build` 或测试不依赖本包生产 build。验证：`pnpm --dir apps/desktop build` 与 `pnpm test`。

#### BUILD-01 · Critical · testing
**仓库无任何 CI（无 `.github`）**

- **AI_FIX**：增加 PR workflow：frozen install → typecheck → build → test → i18n → `go test -race` → e2e（可分 job）→ audit。设为 required checks。

### 4.2 High（执行时按 Wave 消化）

| ID | 维度 | 问题摘要 | AI_FIX 要点 |
|---|---|---|---|
| CORE-03 | robustness | 截断 tool JSON → `{}` 仍执行 | 解析失败发 error chunk，不执行 |
| CORE-04 | tech_solution | Task 绕过 ModelRouter | task-engine-factory 走共享 Router |
| CORE-05 | robustness | usage 覆盖而非累加 | `sumUsage` |
| CORE-06 | robustness | 工具 throw 打挂任务 | ToolRegistry 返回 ok:false 给模型 |
| CORE-07 | security | register 静默覆盖；插件无命名空间 | 冲突抛错；`plugin:` 前缀；unregister |
| CORE-08 | robustness | MCP 无超时/close 不清 pending | timeout + rejectAllPending |
| CORE-09 | robustness | MCP child error 打崩 main；stderr 不读 | onError + 读 stderr |
| CORE-11 | security | 审批只看 args.command | ToolDef.sensitivity + 扫所有字符串参 |
| CORE-12 | security | git_* 不走 assertCommand | readonly 无法禁止 git 写 |
| CORE-14 | robustness | shell/git 忽略 AbortSignal | 转发 signal；git 禁交互 |
| CORE-17 | robustness | Router 超时/重试/熔断语义错误 | idle timeout、退避、半开、不重复 delta |
| CORE-18 | security | adapter 用全局 fetch | SafeHttpClient 实现并注入 |
| CORE-19 | structure | 共享 visibleTools | 移入 EngineRunInput |
| CORE-20 | security | MCP 绑定只在首次 spawn 生效 | run-scoped toolFilter |
| CORE-21 | structure | squadCtx 单槽 + 假 guard | Map by runId |
| DESK-03 | robustness | bootstrap 用错 SecureStorage；无 catch | createSecureStorage + 启动失败对话框 |
| DESK-04 | security | keychain 密钥进 argv | safeStorage 或 stdin |
| DESK-05 | security | IdeBridge 无认证 | Bearer + Host 校验 |
| DESK-06 | tech_solution | file:// + BrowserRouter | HashRouter 或 app:// |
| DESK-07 | structure | 死 register-*-ipc 裸路径 | 删除死模块 |
| DESK-08 | coding_standards | typecheck 31 错 | 修 import/props/类型 |
| DESK-09 | robustness | getFocusedWindow 丢事件/静默拒批 | 用 getMainWindow |
| DESK-10 | security | WebView 策略可缺省；无导航守卫 | 强制策略 + 导航拒绝 |
| DESK-11 | robustness | 迁移非事务 | 每版本 transaction |
| DESK-12 | security | mcp.create/test 任意 spawn | 审批 + 命令校验 |
| DESK-13 | robustness | wipe 删过期 workspace 根 | 实时路径 + 围栏 |
| BUILD-02 | tech_solution | daemon 进 asar 无法 spawn | extraResources / asarUnpack |
| BUILD-03 | tech_solution | package 不构建 daemon/agent | package 依赖 build:daemon |
| BUILD-04 | tech_solution | Windows 缺 .exe | platform 后缀 |
| BUILD-05 | security | Electron 32 EOL | 升到受支持 major |
| BUILD-06 | security | xlsx@0.18.5 | 换 exceljs 或隔离进程 |
| DAEM-03 | robustness | 关机取消 SendResult | 分离 ctx + Drain |
| DAEM-04 | robustness | job panic 杀进程 | recover |
| DAEM-05 | security | HTTP 无超时 | ReadHeaderTimeout 等 |
| DAEM-08 | security | Multica HTTP 弱 | HTTPS+凭证+PathEscape+限长 |
| DAEM-11 | robustness | SQLite 无 busy_timeout、每写重开 | 单句柄+pragma |
| TEST-02 | testing | 功能测失败即 skip | 改为断言或显式 env 门控 |
| TEST-03 | testing | functional --pass-with-no-tests | 去掉并 forbid-only |
| TEST-04 | testing | 单测绿但生产 build 红 | 强制 production build 门禁 |

### 4.3 Medium / Low（摘要表）

| ID | Sev | 摘要 |
|---|---|---|
| CORE-10 | M | MCP 缺 `notifications/initialized` / 协议版本校验 |
| CORE-13 | M | git 工具空 schema |
| CORE-15 | M | 无上下文预算；ContextManager 无消费者；CJK token 双计 |
| CORE-16 | M | SSE reader 泄漏；多行 data 未合并 |
| CORE-22 | M | pause 假；queued cancel 不落库；apiKey 常驻 Map |
| CORE-23 | M | ok=!stderr |
| CORE-24 | M | 元字符黑名单不完整；引号切割错误 |
| CORE-25 | M | Skill/Memory 描述注入 |
| CORE-26 | M | 缺真实 Provider body 契约测试 |
| CORE-27 | M | Plugin 无 unload |
| CORE-28 | M | 代理配置无效 |
| CORE-29 | L | 过时注释 / 死抽象 |
| DESK-14 | M | CSP 缺 img/base/form/worker |
| DESK-15 | M | IPC 抛错 vs 值形 |
| DESK-16 | M | secrets.* 仍注册 |
| DESK-17 | M | DaemonSupervisor 管道死锁/重启竞态/假健康 |
| DESK-18 | M | config.import 信任 apiKeyRef；settings 无白名单 |
| DESK-19 | M | main 硬编码中文 |
| DESK-20 | M | 内存 Map/partition 泄漏 |
| DESK-21 | M | redactSecrets 未接线 |
| DESK-22 | M | 缺索引；历史 DROP 丢审计 |
| DESK-23 | M | Office 无资源上限；PDF base64 IPC |
| DESK-24 | M | Skill 删除留文件 |
| DESK-25 | M | MCP 一次批准变永久 grant |
| DESK-26 | M | 高风险模块缺测 |
| DESK-27 | L | shell 白名单不校验路径参数 |
| DESK-28 | L | navigation deny 中 new URL 可抛 |
| DESK-29 | L | 死 router.tsx；插件子系统永远 deny |
| DESK-30 | L | audit sink 丢 ts |
| DESK-31 | L | runtime.resolveConflict 用 any |
| DAEM-06 | M | 无 token 时 HTTP 全开 |
| DAEM-07 | M | 双套 auth；非 constant-time |
| DAEM-09 | M | busy 布尔在并发下错误 |
| DAEM-10 | M | 队列无上限 |
| DAEM-12 | H/M | ApplyInjection 丢弃参数；workspace 双清理 |
| DAEM-13 | M | workspace 0755 |
| DAEM-14 | M | MCP TOCTOU |
| DAEM-15 | M | 跨进程文件审批无 flock |
| DAEM-16 | H | Multica 产品路径未接线 |
| TEST-05..09 | M/L | Go 未聚合、覆盖倒置、passWithNoTests 等 |
| BUILD-07..10 | M/L | 无 lint、未签名、i18n 未入 CI、死依赖 |

完整 AI_FIX 细节与文件列表见配套 backlog：`wiki/质量报告/JARVIS CodeReview_2026-08-07_AI-backlog.md`。

---

## 5. AI 自动整改操作手册

### 5.1 全局硬约束（任何 Agent 不得违反）

1. `AgentEngine` / REACT / `ModelRouter` / MCPClient **只**在 `packages/core` TypeScript 实现。
2. Renderer **只**从 `@jarvis/core/renderer` 导入。
3. `packages/protocol` 不依赖 `@jarvis/core`。
4. 禁止硬编码模型 ID；API Key 不明文落盘。
5. SQLite migration **只追加**新版本。
6. UI/用户可见错误 zh-CN/en 对称；提交前 `pnpm i18n:check`。
7. TDD：Red → Green → Refactor；**一 ID 一 commit**（`fix:`/`feat:`/`test:`/`chore:`）。
8. 不引入 Preview 排除能力（本地模型、离线模式、云同步、自动更新、全局快捷键、Monaco），除非产品文档同步变更。

### 5.2 推荐 Wave（严格顺序）

```text
Wave 0 — 让质量门能说话
  TEST-01 → DESK-08 → BUILD-01 → BUILD-07(最小 lint) → TEST-05

Wave 1 — 安全止血（用户机器上的即时风险）
  DESK-01 → DESK-02 → CORE-11 → CORE-12 → DESK-12 → DESK-05
  → CORE-18 → DESK-10 → DESK-04 → DESK-18 → BUILD-06

Wave 2 — 引擎正确性（产品主价值）
  CORE-01 → CORE-02 → CORE-03 → CORE-06 → CORE-05
  → CORE-04 → CORE-19 → CORE-07 → CORE-20 → CORE-08 → CORE-09
  → CORE-14 → CORE-17 → CORE-22(pause)

Wave 3 — 打包与 Daemon 可达
  BUILD-02 → BUILD-03 → BUILD-04 → DAEM-01 → DAEM-04 → DAEM-02
  → DAEM-03 → DAEM-05 → DAEM-11 → DESK-03 → DESK-09 → DESK-17

Wave 4 — 产品诚实与扩展
  DESK-06 → CORE-28 或文档降级 → DAEM-16 产品决策
  → CORE-15 → CORE-13 → DESK-23 → BUILD-05
  → DESK-19 → DESK-14 → DESK-15 → DESK-11 → DESK-20

Wave 5 — 测试与发布证据
  TEST-02 → TEST-03 → TEST-04 → CORE-26 → DESK-26
  → BUILD-08 → 全量回归矩阵更新
```

### 5.3 单 ID 工作模板

```md
## Implementing {ID}
StatusBefore: Open
Files: ...
Red: (命令 + 预期失败原因)
Green: (接口/行为变更)
Validation:
- <commands>
Commit: fix(scope): {ID} short title
StatusAfter: Fixed
Evidence: 测试摘要 / 关键 diff 行
```

### 5.4 Fixed 判定最低命令集

```bash
pnpm i18n:check
pnpm typecheck
pnpm --dir packages/core vitest run
pnpm --dir apps/desktop vitest run
pnpm --dir apps/desktop build
cd daemon && go test -race ./...
# Wave5+
pnpm test
pnpm --dir apps/desktop e2e
pnpm test:functional   # 不得 pass-with-no-tests
```

### 5.5 完成定义（DoD）

1. 本报告矩阵中该 ID → Fixed，且 backlog YAML `status: fixed`。
2. 有 Red→Green 证据；验证命令通过。
3. 未破坏 §5.1。
4. 攻击/失败场景在复现测试中不可再成功。

---

## 6. 验证记录（本独立评审）

| 检查 | 结果 |
|---|---|
| 源码走查（core / desktop / daemon / build / test） | 完成；关键结论均有路径证据 |
| `ApprovalGate` 默认 allow | 已核实源码 |
| `settings.set` 无 schema | 已核实 |
| `headless.mjs` / `packages/core/dist` | **不存在** |
| `xlsx@0.18.5` | **仍在** desktop 依赖 |
| MarkdownView 命名导入 | **仍错误** |
| `.github` | **不存在** |
| Electron `^32.0.0` | **仍声明** |
| IdeBridge 认证 | **无** |
| `getFocusedWindow` 用于任务/审批推送 | **仍使用** |
| BrowserRouter + loadFile | **仍组合** |
| 功能套件 `test.skip(true)` | **多套件存在** |
| S2 e2e | `expect(true).toBe(true)` |
| i18n 键对称 | 脚本存在且设计为对称检查 |
| Go 侧引擎重写 | **未发现**（纪律正确，桥缺失） |

---

## 7. 总结与裁决

JARVIS 的 **安全原语与分层架构方向正确**，Core 单测基础扎实，本地优先与引擎所有权纪律在「未做错误事」层面大体成立。

但作为 1.0.0-Preview：**主路径 Agent 工具循环在真实 Provider 上不可靠**；**审批与沙箱可被绕过或默认关闭**；**安装包路径上 Daemon/引擎桥大概率不可用**；**质量门与 CI 不能防止回归**。这些问题不是文档缺口，而是源码级阻断。

**发布裁决：否。**

建议立即启动 Wave 0–2；Wave 3 完成前不得声称「Daemon/Multica 可用」；Wave 5 完成前不得声称「通过发布门禁」。

---

## 附录 A — ID 速查（按严重度）

Critical: CORE-01, CORE-02, DESK-01, DESK-02, DAEM-01, DAEM-02, TEST-01, BUILD-01  

High: CORE-03..09,11,12,14,17..21；DESK-03..13；DAEM-03..05,08,11,12,16；BUILD-02..06；TEST-02..04  

Medium/Low: 见 §4.3 与 backlog。

## 附录 B — 给自动化 Agent 的一句话

> 打开 `wiki/质量报告/JARVIS CodeReview_2026-08-07_AI-backlog.md`，按 Wave 取下一个 `status: open` 的 ID，严格按本报告 §5 执行 TDD 与验证，禁止阅读或复用任何历史「质量报告」中的旧 ID 作为结案依据；以本报告 ID 为唯一真源。
