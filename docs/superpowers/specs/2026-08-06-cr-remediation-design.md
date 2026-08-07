# JARVIS 1.0.0-Preview Code Review 全量整改设计

日期：2026-08-06  
状态：设计已确认，待实施（状态复审见 2026-08-07 报告）

> **复审更新（2026-08-07）**：以 `wiki/质量报告/JARVIS CodeReview_2026-08-07.md` 为当前状态真源；AI 自动整改入口为 `docs/superpowers/specs/2026-08-07-cr-ai-remediation-backlog.md`。原 44 个 CR ID 仍有效，并新增 `SEC-NEW-10`..`SEC-NEW-13`。执行时优先按复审报告 Wave 0→4 顺序，计划正文仍为各 Task 的 TDD 细则。

## 1. 目标与成功标准

本设计以 `wiki/质量报告/JARVIS CodeReview_2026-08-06.md` 的 44 个唯一问题 ID 为整改基线（2026-08-07 复审追加 4 个 SEC-NEW ID，状态矩阵见新报告）。目标不是降低需求范围，而是在保留 Wiki 1.0.0-Preview 承诺的前提下，修复全部高、中、低风险问题，并建立可重复的质量与发布证据。

完成必须同时满足：

1. 44 个 CR ID 均有代码或文档修复，不以“模块存在”“入口存在”代替业务闭环。
2. 每个 CR ID 均有回归测试、目标验证命令和对应提交证据。
3. 全仓 lint、typecheck、unit、Go race、i18n、build、依赖审计和 Electron E2E 通过。
4. S1–S6 主旅程、冷启动、daemon 就绪、数据库查询和 bundle budget 达到 Wiki 指标。
5. 原 CR 报告追加整改矩阵；未验证项不得标记 Fixed。

## 2. 已确认决策

1. **工作基线**：把当前包含大量未提交改动的工作树视为基线，原地修复；不得回退或覆盖用户现有改动。
2. **需求范围**：D9、MCP SSE/HTTP、URL Skills 等现有 Wiki 1.0.0-Preview 能力全部真实实现，不采用降级出 1.0.0-Preview 的方式关闭问题。
3. **提交策略**：每个可独立验证的 TDD Task 创建一个 `feat:`、`fix:`、`test:`、`refactor:`、`docs:` 或 `chore:` 提交。只暂存该 Task 的精确改动，不夹带既有工作树修改。
4. **文档组织**：一份跨切面设计 spec，七份按代码域拆分的 implementation plan，约 20–28 个 Task。
5. **问题追踪**：CR ID 是唯一追踪键。每项只归属一个主 plan；跨域依赖只引用，不重复计数。
6. **实现方法**：所有功能和修复遵循 Red → Green → Refactor；先写能复现缺陷的失败测试。
7. **完成判定**：外部账号、证书或 runner 阻断时必须明确标记“外部验证待执行”，不得伪造成功；代码整改仍须完成。

## 3. 不可破坏约束

- `AgentEngine`、REACT loop、`ModelRouter`、`MCPClient` 唯一实现在 `packages/core` TypeScript；Go 只做协议与调度壳。
- Renderer 只能导入 `@jarvis/core/renderer`，不能导入 Node-dependent full barrel。
- `packages/protocol` 不依赖 `@jarvis/core`。
- Provider/model ID 完全由用户定义，禁止硬编码任何默认模型。
- API Key 永不明文落盘；SQLite、WAL、备份、导出和日志只出现引用或脱敏值。
- SQLite migration 只追加 v13+，不得修改已经发布的 v1–v12。
- Electron main 负责 IPC、安全存储与接线；纯逻辑放 core；renderer 只负责视图和状态投影。
- daemon 最终成为 `tasks` 的唯一写者。
- 新增 UI 和用户可见错误必须同时提供 zh-CN/en。
- 不引入 1.0.0-Preview 已排除的本地模型、离线模式、云同步、自动更新、全局快捷键或 Monaco。

## 4. 七份实施计划与 CR 追踪

### Plan 1：安全信任边界

覆盖：SEC-01、SEC-02、SEC-04、SEC-05、SEC-07、SEC-08、SEC-09。

交付：

- 主窗口导航默认拒绝，外部 HTTP(S) 链接只交给系统浏览器。
- IpcRouter 同时验证可信窗口、sender frame 和应用 origin。
- 文件选择由 main 签发短期 path capability；Office/Workspace 不再接受裸绝对路径。
- Provider/URL Skill 使用统一 URL 安全策略：HTTPS、重定向限制、DNS 解析后阻止私网/loopback/link-local、禁止 URL credentials。
- 搜索密钥迁入 SecureStorage，并安全擦除历史明文。
- Plugin TypeScript 代码迁移到受限独立进程。
- Multica MCP/Env/CLI 注入经本地策略、审批和审计后才生效。

### Plan 2：Engine、Tool 与 MCP 协议

覆盖：BP-02、BP-03、BP-04、BP-05、BP-06、REQ-06。

交付：

- Provider-neutral structured tool turn，完整保留 tool call ID。
- OpenAI 与 Anthropic adapter 正确序列化 assistant tool call 与 tool result。
- Anthropic streaming 完整处理 `tool_use`、`input_json_delta` 和 usage。
- Task、Chat、Office 全部通过 ModelRouter，统一重试、fallback、超时和取消。
- 每次 run 使用不可变工具授权视图，按 Agent/MCP 绑定校验。
- MCP pending 请求具备超时、AbortSignal、帧上限及 child exit/error 全量清理。

### Plan 3：Task 与 Daemon 生命周期

覆盖：BP-01、BP-07、PERF-01、MAINT-01、MAINT-02、MAINT-03、MAINT-04、MAINT-05、MAINT-06。

交付：

- Pause 使用协作式 barrier/checkpoint；暂停后不再产生模型或工具副作用。
- renderer 按 taskId 管理状态；陈旧事件不能覆盖 active task。
- task 终态回收 controller、session、日志和状态 Map；重试数据使用有界缓存或 DB 重建。
- main 通过本地认证 daemon API 创建、暂停、恢复、取消和重试任务；daemon 成为 `tasks` 唯一写者。
- DaemonSupervisor 使用 generation 隔离旧进程回调并正确清理 child。
- ApprovalCenter 在全部终态统一清理 timer。
- daemon busy 由 active task count 推导。
- 生产接线传入真实 local injection，冲突 API 返回实际数据。
- Multica registration 的读写统一加锁。

### Plan 4：Office 与内容处理

覆盖：SEC-03、PERF-02、REQ-01、REQ-05、STD-04、STD-05。

交付：

- 移除存在高危漏洞的 `xlsx@0.18.5`，使用维护且许可兼容的解析方案。
- PDF、XLSX、DOCX、PPTX 解析进入受限进程，具备文件、页数、单元格、解压后大小、时间和内存上限。
- PDF 不再重复读取并以完整 Base64 跨 IPC 复制。
- D9 支持用户配置 transcript API，并支持上传字幕/文本作为无 API 回退；不引入本地模型。
- D10 从用户 Provider/Model 配置选择图像能力与模型，密钥使用 SecureStorage。
- main 返回稳定错误码，renderer 做双语映射。

### Plan 5：1.0.0-Preview 产品能力闭环

覆盖：REQ-02、REQ-03、REQ-04、REQ-07、REQ-08。

交付：

- MCP 统一 transport 支持 stdio、SSE 和 Streamable HTTP。
- URL Skill 的 IPC/UI、下载限制、名称校验和导入冲突流程完整接线。
- 恢复并更新 `docs/provider-guide.md`，加入链接有效性检查。
- Canvas 从路由参数或 active task 获取 taskId，并能从任务入口打开 artifact。
- VersionHistory 挂入 Agent 详情，rollback 后刷新当前配置。

### Plan 6：工程质量门禁

覆盖：STD-01、STD-02、STD-03、DOC-01、TEST-01、TEST-02、TEST-03、TEST-04、SEC-06。

交付：

- 修复全部 TypeScript 错误和过时注释。
- IPC channel 全部收敛到协议常量；删除死路由与未使用路由依赖。
- SecureStorage 只把明确的 item-not-found 映射为 null，其余错误可诊断地失败。
- 增加 lint、format check、coverage 和 `test:all`。
- Playwright/config/e2e 纳入独立 tsconfig。
- Node Vitest 与 Electron E2E 使用隔离 ABI job，测试顺序不再污染 `node_modules`。
- 将 S2 恒真测试替换为真实 mock Provider + 文件/Shell/任务完成旅程。
- 建立 PR CI：frozen install → lint → typecheck → unit → Go race → i18n → build → E2E → audit。

### Plan 7：性能与发布验收

覆盖：PERF-03、PERF-04，并汇总全部 CR 的最终验收。

交付：

- WebView 复用固定隔离 session，并在使用前后清理存储与缓存。
- Markdown/Office 重依赖按路由或语言懒加载，设置可执行 bundle budget。
- CI 自动记录 cold start、daemon ready 和 100k chat query。
- 补齐 S1–S6 Electron E2E、安装器 workflow 与依赖/SBOM 检查。
- 重新执行原 CR 同范围复审并更新整改矩阵。

## 5. 关键架构设计

### 5.1 Renderer 与 IPC 信任边界

调用链为：

`Renderer → preload allowlist → IpcRouter sender/origin policy → capability/permission policy → handler`

安全规则：

- production 只信任打包 renderer origin；development/E2E 只允许显式配置的 loopback origin。
- sender 必须来自当前主窗口的主 frame；高权限通道可额外要求近期用户手势或原生确认。
- `will-navigate`、`will-frame-navigate` 和 `window.open` 默认拒绝应用内导航。
- `mcp.test` 只接受已持久化 server ID，不接受 renderer 提供的 executable/args。

### 5.2 Path Capability

- main 文件选择器或可信 drop 验证流程生成随机、单次或短期 token。
- capability 记录 canonical realpath、允许操作、文件类型、大小、签发窗口、过期时间。
- handler 只接受 token，使用时重新验证 realpath、symlink 边界和操作权限。
- token 不持久化，使用后或窗口关闭时失效。

### 5.3 密钥迁移

搜索、图像和 transcript 配置只保存：

```ts
interface SecretBackedConfig {
  apiKeyRef: string;
  baseUrl?: string;
  enabled: boolean;
}
```

启动迁移顺序：

1. 读取历史 settings 明文。
2. 写入 SecureStorage。
3. 回读并确认。
4. 在 SQLite transaction 中把明文替换为 ref。
5. 迁移失败时保留原值但阻止该能力使用，显示可重试错误；不得静默删除密钥。

导出层使用显式 allowlist/redaction，不再直接导出全部 settings。

### 5.4 Structured Tool Turn

Core 中立消息模型必须能表达：

- assistant 文本与一个或多个 tool calls；
- call ID、tool name 和结构化 arguments；
- 对应 call ID 的 tool result 或 tool error。

OpenAI adapter 映射到 `assistant.tool_calls` 与 `tool.tool_call_id`。Anthropic adapter 映射到 `tool_use` 与后续 user `tool_result` content block。AgentEngine 每轮先保存完整 assistant turn，再执行获准工具并追加结果 turn。

### 5.5 ModelRouter 与每 Run 授权

- `EngineRunInput` 携带不可变 tool names、Agent ID、fallback model chain、deadline 和 AbortSignal。
- ToolRegistry 保存定义；执行时通过 run-scoped authorization view 检查 Agent、Plan mode 和 MCP binding。
- Task、Chat 和 Office 统一调用同一个 ModelRouter 接口。
- 重试只针对可重试网络/429/5xx；工具副作用不自动重放。

### 5.6 Pause 与 Checkpoint

- safe point 位于模型调用前后、审批前后、每个工具调用前后。
- pause 触发 AbortSignal 取消可取消中的模型/MCP/子进程，并等待当前不可中断操作到达 safe point。
- checkpoint 保存已完成 turn 和 tool result；resume 从下一 safe point 继续，不重复副作用。
- cancel 优先于 pause；终态任务不能 resume。

### 5.7 受限执行进程

Office parser 与 plugin runner 不共享 Electron main 上下文，使用长度受限的结构化 RPC。

Plugin runner：

- 禁止 Node built-ins、动态 `require/import`、网络和 child process。
- 仅暴露 `registerTool(def, handler)` 与经过策略包装的 ToolContext。
- 启动和调用均有超时、内存上限、消息大小上限与崩溃回收。
- 插件首次加载显示来源、hash 和权限并要求确认。
- V1 插件包由 `plugin.json` 和预编译的单文件 JavaScript entry 组成；TypeScript 是开发 API，发布者在导入前编译，JARVIS 不在运行时安装依赖或执行任意构建脚本。
- runner 使用静态导入检查和受控 module loader，entry 不能解析插件目录外的模块；仅 manifest 声明且用户批准的 ToolContext 能力可通过 RPC。

Office parser：

- 只读取 capability 指向的单一文件。
- 不接收任意输出路径。
- 解析结果分块返回；超限、超时或崩溃统一映射稳定错误码。

### 5.8 Multica 注入策略

- 远端 payload 先解析为候选 Injection，不直接生成 RunSpec。
- 拒绝 `NODE_OPTIONS`、动态 loader、代理注入和其他危险环境变量。
- MCP executable 必须满足本地路径/签名/允许规则；首次 command 需要本地批准。
- 本地与远端同名冲突必须进入 L38 决策流程。
- 最终生效的 MCP、Skills、Env、CLI 写入脱敏审计。

### 5.9 Tasks 单写者

- daemon 新增本地认证 task API；认证材料只在本机进程间传递。
- main IPC 把 create/control 命令转发给 daemon，不直接更新 `tasks`。
- 本地 AgentEngine 仍在 Electron main 运行：daemon 创建 queued task 并授权本次执行，main 的执行 adapter 把 started/checkpoint/completed/failed transition 回传 daemon API；所有 SQLite 状态写入由 daemon transaction 完成。
- daemon transaction 负责状态机和持久化。
- 迁移期间允许 main 兼容读取，但不允许失败后回退到 main 写入。

### 5.10 Transcript 与远程 MCP 配置

D9 使用中立 `TranscriptProvider`：

```ts
interface TranscriptRequest {
  url?: string;
  title?: string;
  uploadedText?: string;
}

interface TranscriptProvider {
  transcribe(request: TranscriptRequest, signal: AbortSignal): Promise<string>;
}
```

- HTTP transcript adapter 的 endpoint、认证 header 模式和 apiKeyRef 均由用户配置，不硬编码供应商。
- 上传 `.txt`、`.srt`、`.vtt` 时先在本地解析为文本，可不调用 transcript API；摘要模型调用仍遵循用户 Provider 配置。
- 仅 URL 且未配置 transcript provider 时返回稳定 `TRANSCRIPT_PROVIDER_REQUIRED`，不能发送空 prompt。

MCP remote config：

- SSE 使用 legacy HTTP POST + event stream session；Streamable HTTP 使用 MCP 当前 request/response streaming 语义。
- Authorization 和自定义敏感 headers 存 SecureStorage，数据库只保存 ref。
- 两种 HTTP transport 均复用 URL 安全策略、redirect/DNS 复检、deadline、响应大小限制和 AbortSignal。

## 6. 错误处理与可观测性

- main/daemon 返回稳定错误码和安全 detail；renderer 用 i18n 映射用户消息。
- 所有 timeout、abort、child exit、迁移失败和 policy deny 均可区分。
- 不记录 API Key、Authorization header、完整敏感环境变量或任意本地文件内容。
- 子进程失败必须 reject 全部 pending 请求并回收资源。
- 外部网络能力必须有 deadline、重定向上限、响应大小上限和可取消信号。
- 配置迁移、任务状态和远程注入使用幂等操作，重复执行不扩大副作用。

## 7. 测试与验收

### 7.1 安全测试

- 远程 origin、错误窗口和子 frame 的 IPC 调用被拒绝。
- 未签发、过期、篡改、跨窗口和 symlink 越界 capability 被拒绝。
- DB、WAL、backup、export、log 中不存在测试密钥。
- 恶意或超大 Office 文件、无限循环插件和非法 Multica injection 在上限内失败，main 保持响应。

### 7.2 协议与并发测试

- OpenAI/Anthropic 各执行真实两轮 HTTP mock，验证 call ID 和消息形状。
- 两个并发 Agent 的工具与 MCP 授权不串扰。
- Pause 后无新增模型、Shell、文件、MCP 副作用；Resume 不重复工具。
- 双任务事件乱序、daemon 并发 busy、快速 restart 和 registration race 均有测试。

### 7.3 需求测试

- stdio/SSE/Streamable HTTP MCP 都完成 initialize、list 和 call。
- URL Skill 经 UI 导入并覆盖恶意 URL、名称和重定向。
- D9 覆盖 transcript API、上传字幕回退和失败重试。
- D10 覆盖用户 model、缺 key/ref 和第三方 compatible endpoint。
- Canvas artifact 与 VersionHistory rollback 从真实产品入口可达。

### 7.4 质量与性能阈值

- core：85% lines、80% branches。
- main：80% lines、75% branches。
- renderer stores：90% lines、85% branches。
- 新增安全策略模块：90% branches。
- Electron cold start `<3s`。
- daemon ready `<1s`。
- 100k chat message 查询 `<100ms`。
- renderer 主 bundle 和主要 lazy chunk 使用当前构建基线设首个 budget，整改后不得回升。

### 7.5 全局验证

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm coverage
pnpm i18n:check
pnpm build
cd daemon && go test ./... && go test -race ./...
cd apps/desktop && pnpm e2e
pnpm audit --prod
```

Node unit 与 Electron E2E 必须在隔离 ABI 环境执行，不得依靠测试顺序成功。

## 8. 实施顺序

1. 修复 TEST-01 和 Node/Electron ABI 最小基线，使局部测试可重复。
2. 执行 Plan 1，封闭主进程安全攻击面。
3. 执行 Plan 2，修复模型工具协议与运行授权。
4. 执行 Plan 3，修复 Pause、事件、daemon 和单写者。
5. 执行 Plan 4，完成 Office 隔离及 D9/D10。
6. 执行 Plan 5，完成 MCP/Skills/Canvas/VersionHistory/Provider 文档。
7. 完成 Plan 6 的全部 CI、覆盖率和 E2E 门禁。
8. 执行 Plan 7 性能、发布与最终复审。

Plan 之间只在接口已稳定时并行。Plan 2 是完整工具 E2E 和 Pause checkpoint 的前置；Plan 6 的 E2E 场景依赖前五个 plan，但 typecheck/ABI 基线可最先实施。

## 9. 回滚与工作树保护

- 每个 Task 独立 commit，可按 Task 回滚。
- 不使用 `git reset --hard`、`git checkout --` 或其他会丢失工作树改动的命令。
- 提交前检查 staged diff，确保不包含用户既有、不属于本 Task 的修改。
- schema migration 采用前向修复，不修改历史 migration。
- 密钥迁移和 tasks 写者切换必须具备幂等测试；失败时保持旧数据可恢复，但不得恢复不安全运行路径。

## 10. 最终交付

- 本设计 spec。
- 七份可逐 Task 执行的 TDD implementation plan。
- 约 20–28 个独立提交。
- CI、覆盖率、E2E、性能和依赖审计证据。
- 更新后的 `JARVIS CodeReview_2026-08-06.md` 整改矩阵。
- 44 项全部 Fixed 后的复审结论。
