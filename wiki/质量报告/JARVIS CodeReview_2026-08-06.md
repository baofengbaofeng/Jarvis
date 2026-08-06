# JARVIS Code Review 报告

## 1. 基本信息

| 项目 | 内容 |
|---|---|
| 项目名称 | JARVIS V1.0（本地优先桌面 AI Agent 平台） |
| 评审日期 | 2026-08-06 |
| 评审范围 | 当前工作树完整源码：Electron Main/Preload/Renderer、`packages/core`、`packages/protocol`、`packages/i18n`、Go daemon、测试、构建配置与依赖 |
| 代码基线 | `master`，HEAD `08f60cd60f7bc4b2191f12edda2b38398f427504`，并包含评审时工作树中的未提交修改与新增文件 |
| 技术栈 | Electron 32、React 19、TypeScript 5、Zustand、react-i18next、better-sqlite3、Go、SQLite、pnpm/Turborepo、Vitest、Playwright |
| 评审方式 | Wiki/设计基线对照、全仓静态走查、跨层调用链分析、构建/类型/测试/竞态验证、生产依赖漏洞审计 |
| 结论 | **不建议合入或发布**；存在可形成主进程命令执行链的高风险安全问题、可达的高危依赖漏洞、任务暂停语义失真和质量门禁失败 |

### 1.1 参考 Wiki 与设计文档清单

已优先阅读并作为评审基线：

1. `wiki/需求文档/JARVIS需求文档_V1.0_20260802.html`
2. `wiki/产品文档/JARVIS产品文档_V1.0_20260802.html`
3. `wiki/技术文档/JARVIS技术方案_V1.0_20260802.html`
4. `wiki/产品原型/V1.0/index.html`
5. `wiki/产品原型/V1.0/manifest.json` 及其 50 个原型页面的深/浅色 SVG
6. `docs/superpowers/plans/2026-08-03-m0-skeleton.md`
7. `docs/superpowers/plans/2026-08-03-m1-chat-model.md`
8. `docs/superpowers/plans/2026-08-03-m2-agent-basic.md`
9. `docs/superpowers/plans/2026-08-03-m3-toolchain.md`
10. `docs/superpowers/plans/2026-08-03-m4-coding.md`
11. `docs/superpowers/plans/2026-08-03-m5-office.md`
12. `docs/superpowers/plans/2026-08-03-m6-multi-agent.md`
13. `docs/superpowers/plans/2026-08-03-m7-multica-runtime.md`
14. `docs/superpowers/plans/2026-08-03-m8-ui-polish.md`
15. `docs/superpowers/specs/2026-08-05-desktop-installers-design.md`
16. `CLAUDE.md`
17. `wiki/质量报告/JARVIS CodeReview_2026-08-05.md`（仅作历史整改状态参考，所有遗留结论均重新核验）

注意：`docs/provider-guide.md` 在当前工作树中已删除，无法作为现行第三方 Provider 接入说明使用；这与 B12 的文档化交付要求不一致，见 REQ-04。

### 1.2 关键业务与架构基线

- 默认本地运行，数据保存在 SQLite；无遥测、无云同步、无本地模型或离线模式。
- AgentEngine/REACT Loop/ModelRouter/MCPClient 应唯一实现在 `packages/core`；Go `jarvis-agent` 仅为调用同一 TS 引擎的协议壳。
- API Key 只能保存到 Keychain/系统安全存储，数据库和配置导出只保存引用。
- Renderer 只能导入 `@jarvis/core/renderer`；IPC 应使用协议常量和值形返回。
- V1.0 必须支持 zh-CN/en，UI 和系统提示不得硬编码单一语言。
- SQLite 应遵守每表单写者；技术方案将 `tasks/squads/agent_messages/agent_call_edges/audit_logs/token_usage/runtime_profiles` 分配给 daemon。
- V1.0 需要覆盖 S1–S6 主旅程，并达到冷启动 `<3s`、daemon 就绪 `<1s` 等性能目标。

## 2. 总体概览

### 2.1 质量结论

项目的五层结构、renderer-safe 入口、IPC allowlist、密钥安全存储、沙箱 canonical path、Go 竞态测试等基础方向正确；Core 的纯逻辑测试数量也较充足。

但当前版本仍不具备 V1.0 冻结或发布条件：

1. 主窗口允许导航到远程页面，而 preload 会继续暴露高权限 IPC；结合 `mcp.test` 的任意进程启动能力，可形成用户点击链接后的主进程命令执行链。
2. 多个 IPC 接收 renderer 提供的裸文件路径，可读取、复制或上传本机文件。
3. `xlsx@0.18.5` 的两个高危漏洞位于真实文件分析路径，且解析发生在 Electron main。
4. “暂停任务”只修改状态，模型和工具仍继续执行。
5. 联网搜索 API Key 以明文写入 SQLite，并随配置导出，直接违反“密钥永不明文落盘”约束。
6. Anthropic 工具流未解析，且 AgentEngine 第二轮 tool message 缺少协议必需关联字段，真实 REACT 工具链不可用。
7. PluginHost 在主进程上下文使用 Node VM 执行不可信插件，缺少超时与进程隔离。
8. 类型检查失败，单元测试受原生模块 ABI 阻断，真实 Electron E2E 无法启动。
9. D9 视频摘要、MCP SSE/HTTP、URL Skills 导入、Canvas 任务产物等 V1.0 能力仍是占位或未接线。

### 2.2 风险与问题统计

| 风险等级 | 数量 | 说明 |
|---|---:|---|
| 高 | 12 | 可利用安全链、明文密钥、工具协议失效、可达高危依赖、用户安全控制失效、质量门禁阻断 |
| 中 | 25 | 架构/需求偏差、资源泄漏、测试缺口、扩展性和可靠性问题 |
| 低 | 7 | 规范、注释、死代码、错误分类和生命周期细节 |
| **合计** | **44** | 按唯一问题计数，跨维度影响不重复计数 |

整体风险等级：**高**。

## 3. 分维度评审结果

## 3.1 代码规范

### STD-01【中】缺少统一静态规范与持续集成门禁

- **位置**：`package.json:6-20`、仓库根目录（无 ESLint/Prettier 配置）、`.github/`（目录不存在）
- **问题描述**：根脚本只有 build/test/typecheck/i18n；没有 lint、format check、覆盖率和 CI 工作流。当前类型错误和 E2E 占位因此可长期进入工作树。
- **问题影响**：命名、未使用代码、危险 API、格式和测试门禁只能依赖人工；跨 160+ TS 模块后维护成本会快速上升。
- **修复建议**：增加 ESLint（TypeScript/React/Electron 安全规则）、Prettier、`pnpm lint`、`pnpm coverage`；建立 CI 顺序门禁：install frozen → lint → typecheck → unit → Go race → i18n → build → Electron E2E。

### STD-02【低】IPC 通道仍大量使用裸字符串

- **位置**：`packages/protocol/src/ipc-allowlist.ts:41-101`、`apps/desktop/src/renderer/src/pages/CodingPanelPage.tsx:18-31`、`apps/desktop/src/renderer/src/components/settings/ConfigImportExportView.tsx:16-25`
- **问题描述**：协议层已有 `IpcChannel`，但 allowlist 和大量页面仍直接写 `'office.*'`、`'config.*'`、`'workspace.*'` 等字符串。
- **问题影响**：重命名无法由类型系统覆盖；handler、allowlist、renderer 三处容易漂移。
- **修复建议**：将所有通道收敛到 `IpcChannel/IpcEvent`；为每个通道定义请求/响应映射类型，并让 preload 的 `invoke` 使用泛型约束。

### STD-03【低】存在死路由与重复路由依赖

- **位置**：`apps/desktop/src/renderer/src/router.tsx:1-16`、`apps/desktop/package.json:24,34`
- **问题描述**：`router.tsx` 保留旧对象路由表，实际 `App.tsx` 使用 `react-router-dom`；同时依赖 `@tanstack/react-router` 和 `react-router-dom`。
- **问题影响**：增加依赖面、审计噪音和维护者认知负担。
- **修复建议**：删除未使用路由文件和 `@tanstack/react-router`，或完成单一路由方案迁移；禁止同时保留两套未统一的路由框架。

### STD-04【低】主进程返回硬编码中文系统错误

- **位置**：`apps/desktop/src/main/ipc/office.ts:323-331`
- **问题描述**：图像 API Key 缺失错误固定为中文，renderer 直接展示 main 返回的文本。
- **问题影响**：英文界面出现中文系统提示，违反 A11 双语一致要求。
- **修复建议**：main 返回稳定错误码（如 `IMAGE_API_KEY_MISSING`），renderer 通过 i18n 映射；其他 main/daemon 错误也采用同一模式。

### STD-05【中】图像生成硬编码模型 ID，违反 Q4

- **位置**：`packages/core/src/office/image.ts:10-20`
- **问题描述**：未传 model 时静默使用 `dall-e-3`，与“Provider/model ID 全部由用户定义、不得写入代码或种子数据”的硬约束冲突。
- **问题影响**：第三方 OpenAI-compatible Provider 可能没有该模型；用户配置被固定默认值绕过。
- **修复建议**：删除默认 model，要求调用方传入用户 models 表中的图像模型引用；缺失时返回稳定配置错误码。

## 3.2 代码注释

### DOC-01【低】关键注释已与实现不同步

- **位置**：`packages/core/src/agent/AgentEngine.ts:39-43`
- **问题描述**：注释仍称 `ChatRequest` 没有 `tools` 字段、等待未来接线，但 `model/types.ts` 和 `AgentEngine.ts:61-68` 已实际注入 tools。
- **问题影响**：误导后续开发者判断计划模式和工具注册是否完成，可能导致重复实现或错误修改。
- **修复建议**：删除里程碑过程型旧注释，改为解释当前不变量；在评审门禁中增加“修改实现时同步相邻注释”的检查项。

## 3.3 性能分析

### PERF-01【中】任务生命周期 Map 仍随任务数无限增长

- **位置**：`apps/desktop/src/main/ipc/tasks.ts:29-30,71-74,91-95,107-124`、`packages/core/src/task/TaskOrchestrator.ts:41-45`
- **问题描述**：单任务日志限制为 500 行，但 `taskLogs`、`taskSessions`、`states`、`controllers`、`inputs` 没有终态回收。
- **问题影响**：长时间常驻后，每个历史任务都会保留 Map entry、输入、环境和可能的会话引用；本地 Agent 高频使用时内存持续增长。
- **修复建议**：终态时删除 controller/session/log；重试输入采用有界 LRU 或从 DB 重建；增加一万任务压力测试和 heap 快照断言。

### PERF-02【中】大文件解析与重复读取阻塞 Electron main

- **位置**：`apps/desktop/src/main/ipc/office.ts:177-193,247-268,341-371`
- **问题描述**：PDF、XLSX、PPTX 使用同步读取或 main 内 CPU 密集解析；PDF 被读取两次，并把完整内容再编码为 Base64 跨 IPC。
- **问题影响**：大文件会阻塞窗口、IPC、daemon 管理和审批；原始 Buffer、Uint8Array、Base64 和 renderer 副本同时存在，峰值内存可达文件大小数倍。
- **修复建议**：在受限 worker/utility process 中流式解析；设置文件大小/页数/解压后大小/超时上限；PDF 展示使用受控 `file://`/自定义协议或分块传输，避免全量 Base64。

### PERF-03【中】WebView 每次创建唯一 session 且从不释放

- **位置**：`apps/desktop/src/main/webview/WebViewHost.ts:20-31,37-59`
- **问题描述**：每次打开网页都创建新的内存 partition，注释明确承认这些 session 在应用生命周期内累积。
- **问题影响**：频繁网页总结后会累积 session、网络栈和存储对象。
- **修复建议**：复用固定隔离 partition，并在每次使用前后 `clearStorageData/clearCache`；补 100 次打开/关闭后的资源稳定性测试。

### PERF-04【中】性能目标没有自动验证且主 bundle 过大

- **位置**：`apps/desktop/src/renderer/src/components/chat/MarkdownView.tsx:1-3`、`turbo.json:3-7`
- **问题描述**：构建产物主 renderer JS 约 2.37 MB，PDF 页面 chunk 约 852 KB，pdf worker 约 1.26 MB；`react-syntax-highlighter` 和完整 Prism 主题静态进入聊天主路径。没有冷启动或 daemon 就绪性能测试。
- **问题影响**：与 Wiki 的冷启动 `<3s` 目标存在风险，低配置设备首次渲染成本偏高。
- **修复建议**：对 Markdown 高亮器按语言懒加载或改用更轻方案；拆分聊天/设置/办公依赖；在 CI 记录 bundle budget、Electron cold start 和 daemon readiness。

## 3.4 安全性

### SEC-01【高/阻断】主窗口远程导航可串联高权限 preload 与任意命令执行

- **位置**：`apps/desktop/src/main/window/WindowManager.ts:18-43`、`apps/desktop/src/preload/index.ts:4-16`、`packages/protocol/src/ipc-allowlist.ts:45-48`、`apps/desktop/src/main/ipc/mcp.ts:59-69`、`packages/core/src/mcp/transport.ts:12-18`
- **问题描述**：主窗口只处理 `window.open`，未拦截同窗口 `will-navigate/will-frame-navigate`。模型 Markdown 链接未改写，用户点击可使主窗口加载远程页面；preload 随导航再次执行并暴露 `window.jarvis`。远程页面随后可调用 allowlist 中的 `mcp.test`，令 main 执行 renderer 提供的 `command/args`。
- **问题影响**：可形成“模型/网页链接 → 用户点击 → 远程页面 → IPC → `/bin/sh -c`”的本机命令执行链；同一权限面还包含 wipe、文件读取、配置修改等高危操作。
- **修复建议**：主窗口仅允许应用自身 origin，默认阻止所有导航；Markdown 链接只允许 `https:` 并交给系统浏览器；IpcRouter 校验 `event.senderFrame.url` 和窗口身份；`mcp.test` 不接受任意可执行路径，需测试已持久化且经原生确认的配置；恢复 `sandbox:true`。

### SEC-02【高/阻断】多个 IPC 接受裸路径，可读取或外传本机文件

- **位置**：`apps/desktop/src/main/ipc/office.ts:247-268,341-371`、`apps/desktop/src/main/ipc/workspace.ts:52-60,74-90`、`apps/desktop/src/main/ipc/register-coding-ipc.ts:23-25`
- **问题描述**：`office.pdf.*`、`office.file.analyze` 和 `workspace.copyFiles` 信任 renderer 路径。`copyFiles(任意常规文件)` 后可通过 `workspace.read(basename)` 读取；Office summarize/analyze 还会把解析文本发送给 Provider。
- **问题影响**：renderer 被攻陷后可读取 SSH 配置、源码、配置文件等用户权限内文件；支持格式的文档可能直接被外传到第三方模型。
- **修复建议**：原生选择/拖拽后由 main 签发一次性 path capability；所有后续读取只接受 capability；校验 realpath、类型、大小和有效期；禁止 IPC 接受裸绝对路径。

### SEC-03【高/阻断】可达的 `xlsx@0.18.5` 高危漏洞运行在主进程

- **位置**：`apps/desktop/package.json:37`、`apps/desktop/src/main/ipc/office.ts:347-355`
- **问题描述**：生产依赖审计发现 3 个高危公告，其中 SheetJS 两项位于真实导入路径：CVE-2023-30533（原型污染，CVSS 7.8）和 CVE-2024-22363（ReDoS，CVSS 7.5）。npm 上的 `xlsx` 包已不维护。
- **问题影响**：恶意工作簿可冻结 Electron main；原型污染可能影响同一主进程后续对象行为。
- **修复建议**：迁移到官方已修复版本（至少 0.20.2 的受信分发渠道）或维护活跃的替代解析器；解析必须进入受限子进程并有超时/内存上限。另一个 React Router RSC CSRF 公告仅影响未使用的 unstable RSC 路径，当前不可达，但仍应升级或记录例外。

### SEC-04【中】Skill frontmatter 名称可造成目录穿越写入

- **位置**：`packages/core/src/skills/SkillsLoader.ts:6-20`、`apps/desktop/src/main/ipc/skills.ts:17-38`
- **问题描述**：Skill 的 `name` 未限制为安全目录名，随后直接拼入 `.jarvis/skills/${name}/SKILL.md`。
- **问题影响**：导入恶意 Skill 时，`../../` 等名称可把 `SKILL.md` 写出预期目录，并可能覆盖工作区内同名目标。
- **修复建议**：拒绝分隔符、`.`/`..`、绝对路径和控制字符；对目标执行 `resolve/relative/realpath` 边界校验；复制前检查目标不存在或显式确认覆盖。

### SEC-05【中】Provider Base URL 缺少协议与内网策略，形成 main 侧 SSRF 面

- **位置**：`apps/desktop/src/main/ipc/providers.ts:6-37`、`packages/core/src/model/adapters/openai.ts`、`packages/core/src/model/adapters/anthropic.ts`
- **问题描述**：用户/renderer 可保存任意 base URL，main 随后发起请求；没有协议、凭据、loopback、link-local 或私网地址策略。
- **问题影响**：被攻陷 renderer 可利用 Provider 测试或模型请求探测本机/局域网服务。
- **修复建议**：仅允许 `https:`，本地开发例外需显式开关和确认；解析 DNS 后阻止 loopback/link-local/private ranges；禁止 URL credentials 和重定向到受限地址。

### SEC-06【低】SecureStorage 将系统错误误判为“未找到”

- **位置**：`apps/desktop/src/main/secrets/SecureStorage.ts:31-38,64-68`
- **问题描述**：默认执行器捕获所有 `security` 命令错误并转成 stdout/stderr；`get` 对任意 stderr 且无 stdout 都返回 null。
- **问题影响**：Keychain 权限、进程启动或系统故障会被吞掉，用户只看到缺少 Key，降低故障可诊断性。
- **修复建议**：保留退出码；仅将明确的 item-not-found 映射为 null，其余错误抛出并写脱敏审计。

### SEC-07【高/阻断】联网搜索 API Key 明文写入 SQLite 并进入配置导出

- **位置**：`apps/desktop/src/renderer/src/components/office/SearchProvidersPage.tsx:21-27,36-46`、`apps/desktop/src/main/ipc/settings.ts:9-23`、`apps/desktop/src/main/ipc/config.ts:35-52`
- **问题描述**：搜索 Provider 配置包含原始 `apiKey`，通过通用 `settingsSet` 序列化到 `settings.value_json`；配置导出读取并导出全部 settings。
- **问题影响**：API Key 出现在 `jarvis.db`、SQLite 备份和配置导出文件中，直接违反“API keys never land on disk in plaintext”约束。
- **修复建议**：迁移为 `apiKeyRef + SecureStorage`；为现有 `search_providers` 行执行一次性安全迁移并擦除明文；配置导出只保留引用或空占位；增加数据库、备份和导出均不含密钥的回归测试。

### SEC-08【高/阻断】PluginHost 使用 Node VM 执行不可信插件代码

- **位置**：`packages/core/src/plugins/PluginHost.ts:9-24`
- **问题描述**：直接读取插件 `index.js` 并 `vm.runInContext`，无执行超时、签名、资源限制或进程隔离。Node `vm` 不是安全边界，恶意代码还可无限循环阻塞事件线程。
- **问题影响**：导入恶意插件可能导致主进程拒绝服务、沙箱逃逸或注册危险工具。
- **修复建议**：V1.0 优先改为声明式 manifest；必须执行代码时放入最小权限子进程/utility process，通过结构化 RPC 暴露有限能力，并增加签名/来源确认、超时和内存限制。

### SEC-09【高/阻断】Multica 下发的 MCP 命令与环境未经安全策略即进入执行链

- **位置**：`daemon/internal/multica/acp/payload.go:31-37`、`daemon/internal/multica/acp/inject.go:34-75`、`daemon/cmd/jarvis-agent/run.go:104-129`
- **问题描述**：远端 payload 的 MCP `command/args`、CLI args 和部分环境变量直接合并进 RunSpec；daemon 未实施命令白名单、危险环境变量过滤或用户审批。
- **问题影响**：被攻陷或误配置的 Multica Server 可突破本地信任边界，向 Agent 路径注入任意 stdio MCP 命令或 `NODE_OPTIONS` 等危险环境。
- **修复建议**：定义远程注入信任策略；MCP executable 使用允许目录/签名清单，首次执行需本地审批；拒绝危险环境变量和未声明 CLI 参数；将最终生效配置展示给用户并审计。

## 3.5 代码最佳实践

### BP-01【高/阻断】Task “暂停”只改变状态，执行和副作用继续发生

- **位置**：`packages/core/src/task/TaskOrchestrator.ts:73-84,128-138`
- **问题描述**：`pause()` 不触发 AbortSignal、不等待 barrier、不暂停子进程；`resume()` 也只是状态变化。暂停后的模型请求、Shell、写文件和 MCP 工具仍继续执行，结束后可直接变 completed。
- **问题影响**：UI 给出错误的安全控制感知；用户认为已暂停时仍可能发生不可逆操作。
- **修复建议**：实现协作式 pause barrier，在模型步骤、审批和工具执行前检查；对子进程采用终止+checkpoint+恢复语义。若短期无法实现，应移除 Pause UI/IPC，不能伪装支持。

### BP-02【中】真实 Task/Office 路径绕过 ModelRouter 的重试与 fallback

- **位置**：`apps/desktop/src/main/ipc/task-engine-factory.ts:46-61,95-99`、`apps/desktop/src/main/ipc/office.ts:82-112`、`packages/core/src/model/router.ts:28-54`
- **问题描述**：默认 Task 和 Office 直接 `createAdapter().chat()`；普通聊天也没有传 fallback 链。虽然 core 的 ModelRouter 有 retry/fallback 单测，但业务主路径未使用。
- **问题影响**：B10 和 L34 仅“模块存在”，实际 Provider 429/5xx 时 Task/Office 无统一超时、重试、熔断或备用模型。
- **修复建议**：所有模型调用统一经一个 ModelRouter 实例；补 Agent fallback 字段、迁移和 UI；实现带抖动指数退避，并以端到端测试验证主路径。

### BP-03【中】共享 ToolRegistry 破坏 MCP 按 Agent 隔离

- **位置**：`apps/desktop/src/main/ipc/mcp.ts:75-99`、`apps/desktop/src/main/ipc/task-engine-factory.ts:69-79`、`apps/desktop/src/main/ipc/tasks.ts:137-139`
- **问题描述**：绑定 Agent 的 MCP 工具注册到共享全局 registry；后续其他 Agent 的 `toolRegistry.list()` 也会看到它，审批阶段不复核 `agentIds`。
- **问题影响**：违反 G6 Agent 隔离；未绑定 Agent 可能调用其他 Agent 的 MCP 工具或触发错误审批。
- **修复建议**：按 run 构建不可变工具视图，或在 registry execute 前强制校验 Agent 绑定；缓存 transport 与工具授权分离。

### BP-04【中】MCP 请求没有超时、退出和 pending 清理

- **位置**：`packages/core/src/mcp/McpClient.ts:20-51,70-78`、`packages/core/src/mcp/transport.ts:12-18`
- **问题描述**：pending Promise 只在收到合法响应时删除；未监听 child `error/exit`，也无请求超时。无响应 MCP 可永久挂起 `mcp.test` 或任务。
- **问题影响**：任务队列和设置测试可长期卡住；pending Map 与子进程资源泄漏。
- **修复建议**：为 initialize/list/call 设置超时和 AbortSignal；child exit/error 时 reject 全部 pending；限制单 server 并发和输出帧大小。

### BP-05【中】`visibleTools` 是共享 Engine 可变状态，存在并发串扰

- **位置**：`packages/core/src/agent/AgentEngine.ts:37-47,56-68`、`apps/desktop/src/main/ipc/tasks.ts:134-148`
- **问题描述**：每个任务提交前覆盖同一 engine 的 `visibleTools`，而同 Agent 默认允许 6 个并发任务。多步执行期间该值可被其他任务改变。
- **问题影响**：普通任务可能错误丢失写工具；Plan 任务可能看到写工具并反复被执行门拒绝。现有执行门可阻止 Plan 真正写入，因此安全等级降为中。
- **修复建议**：把 visible tool names 放入 `EngineRunInput`，在 run 开始时生成不可变集合，禁止任务级配置写入 engine 实例字段。

### BP-06【高/阻断】REACT 第二轮工具消息不符合 Provider 协议

- **位置**：`packages/core/src/agent/AgentEngine.ts:80-107`、`packages/core/src/model/types.ts:4-13`
- **问题描述**：模型返回 tool call 后，Engine 未写入包含 `tool_calls`/`tool_use` 的 assistant 消息；工具结果消息也没有 `tool_call_id` 或对应 block ID。`ModelMessage` 类型无法表达这些字段。
- **问题影响**：OpenAI-compatible 第二轮通常会因 tool message 无对应 assistant tool call 而返回 400；Anthropic 也无法构造正确的 `tool_result` block。现有 mock 测试未验证真实请求体。
- **修复建议**：建立 Provider-neutral structured tool turn，adapter 分别映射 OpenAI 与 Anthropic 消息格式；保存原 tool call ID；增加至少两步真实 HTTP mock 集成测试。

### BP-07【高】陈旧任务事件可覆盖当前任务状态

- **位置**：`apps/desktop/src/renderer/src/stores/ipc-subscriptions.ts:39-64`、`apps/desktop/src/renderer/src/stores/task-store.ts:17-31`
- **问题描述**：事件处理先调用 `setStatus(id, ...)`，而 store 的 `setStatus` 忽略 id；之后才判断事件是否属于 activeTask。
- **问题影响**：任务 A 的延迟完成/失败事件会把正在运行的任务 B 显示为 completed/failed，导致错误控制按钮和用户判断。
- **修复建议**：在 store 原子检查 `id === activeTaskId` 后更新；或将状态改为 `Record<taskId, status>`，selector 读取 active task。补双任务事件乱序测试。

## 3.6 单元测试覆盖率

### TEST-01【高/阻断】当前工作树无法通过 TypeScript 类型检查

- **位置**：`packages/core/src/agent/AgentEngine.spec.ts:79`、`packages/core/src/model/adapters/adapters.spec.ts:38,45`
- **问题描述**：`pnpm typecheck` 失败：`captured.tools` 被推断为 never、回调参数隐式 any、fetch mock 签名不兼容、null 强制转换不安全。
- **问题影响**：当前代码不满足仓库最基本质量门禁；测试代码与接口变化不同步。
- **修复建议**：修正 mock 和捕获变量类型，不使用掩盖问题的宽泛断言；CI 强制 typecheck 通过后才能运行发布任务。

### TEST-02【中】没有真实覆盖率数据与阈值，关键状态模块仍缺测试

- **位置**：`apps/desktop/vitest.config.ts:4-13`、`package.json:6-20`、`apps/desktop/src/renderer/src/stores/`
- **问题描述**：未配置 coverage provider、报告或阈值。14 个 renderer store/初始化模块中，仅 agent/approval/chat/task/toast/workflow/runtime/settings 有 spec；provider/taskboard/squad/init/ipc-subscriptions/usage 无专项 spec。
- **问题影响**：无法回答行/分支覆盖率；IPC 初始化、重复订阅、失败恢复和并发状态最容易回归。
- **修复建议**：接入 V8 coverage；初始阈值建议 core 85% lines/80% branches、main 80%/75%、renderer stores 90%/85%；逐步提高且禁止下降。

### TEST-03【中】E2E 门禁无效且 S2 用例是恒真占位

- **位置**：`apps/desktop/e2e/s2-file-shell.spec.ts:1-18`、`apps/desktop/e2e/electron-smoke.spec.ts:17-115`、`apps/desktop/playwright.config.ts:10-34`
- **问题描述**：S2 Playwright 只有 `expect(true).toBe(true)`。本次 E2E 10 项中仅 4 项通过（含该占位）；renderer 2 项因浏览器未安装失败，真实 Electron 首项 `Process failed to launch`，后 3 项未运行。
- **问题影响**：Wiki S1/S2 主旅程和真实 preload/SQLite/daemon 回归没有可靠发布门禁。
- **修复建议**：CI 显式安装 Playwright 浏览器；修复 Electron launch 并保留 stdout/stderr/trace；用本地 mock OpenAI server 实现真正的 S2 文件读写/Shell/任务完成断言。

### TEST-04【中】Playwright/E2E 配置逃逸 TypeScript 门禁

- **位置**：`apps/desktop/playwright.config.ts:10-34`、`apps/desktop/tsconfig.json:7`
- **问题描述**：E2E 和配置文件未包含在 desktop typecheck；`webServer` 放在 project 内的写法与当前 Playwright 类型定义不一致，因此错误不会被根 typecheck 捕获。
- **问题影响**：E2E 可在测试代码执行前因配置失效；发布门禁对配置回归不可见。
- **修复建议**：增加 `tsconfig.e2e.json`/`tsconfig.config.json`；把共享 webServer 移到顶层或按官方 schema 配置，并将两者纳入根 typecheck。

## 3.7 需求匹配度

### REQ-01【中/发布阻断】D9 视频摘要实际不可用

- **位置**：`apps/desktop/src/main/ipc/office.ts:197-204,299-315`、`apps/desktop/src/renderer/src/components/office/VideoSummary.tsx:4-7`
- **问题描述**：`getTranscript()` 永远返回 undefined，UI 固定得到“未配置 transcript”错误。Wiki 将 D9 纳入 V1.0。
- **问题影响**：存在菜单和页面但没有业务闭环，属于表面实现。
- **修复建议**：接入明确的字幕/转写 Provider，配置进入 SecureStorage；无字幕时支持本地文件上传转写或明确从 V1.0 范围移除。

### REQ-02【中/发布阻断】MCP SSE/HTTP 只存在于数据模型，执行仅支持 stdio

- **位置**：`apps/desktop/src/main/ipc/mcp.ts:59-61,75-90`、`apps/desktop/src/renderer/src/pages/settings/McpSettingsPage.tsx:27-38`
- **问题描述**：Wiki 要求 stdio/SSE/HTTP；测试明确拒绝非 stdio，注册时直接跳过，UI 创建还硬编码 stdio。
- **问题影响**：G4/G5 接口范围与实现不一致，第三方 MCP 接入受限。
- **修复建议**：实现统一 transport 抽象、SSE/streamable HTTP 鉴权与生命周期；若不交付，应同步 Wiki 和 UI 移除不可用选项。

### REQ-03【中】L32 URL Skills 导入底层存在但产品未接线

- **位置**：`packages/core/src/skills/SkillsLoader.ts:43-53`、`apps/desktop/src/main/ipc/skills.ts:17-24`、`apps/desktop/src/renderer/src/pages/settings/SkillsSettingsPage.tsx:9-16`
- **问题描述**：Core 有 URL 辅助函数，但 IPC/UI 只有本地目录导入；Wiki 明确要求“本地文件夹 + URL”。
- **问题影响**：L32 验收不通过，且用户看不到已有底层能力。
- **修复建议**：增加 URL 导入 IPC/UI；限制 HTTPS、重定向、大小、内容类型和私网地址，并复用 SEC-04 名称校验。

### REQ-04【中】第三方 Provider 接入文档从当前工作树删除

- **位置**：`docs/provider-guide.md`（当前工作树删除）、`resources/provider-templates/openai-compatible.json`
- **问题描述**：CLAUDE.md 和 B12 将 provider guide 作为第三方接入说明，但文件已删除。
- **问题影响**：自定义 Provider 的认证、URL、模型和兼容限制缺少交付文档，和 V1.0 文档化要求冲突。
- **修复建议**：恢复并更新 provider guide；将模板字段、无硬编码 model id、API key 引用和兼容差异写入文档，并加入链接有效性检查。

### REQ-05【中】D10 图像生成没有可用的设置入口

- **位置**：`apps/desktop/src/main/ipc/office.ts:206-214,317-329`、`apps/desktop/src/main/ipc/register-safety-ipc.ts:35`
- **问题描述**：代码注释明确“没有 image-provider settings UI”，只能依赖手工存在的 `image.api_key_ref`。
- **问题影响**：普通用户无法完成 D10 配置，入口默认报错，功能不满足可用性验收。
- **修复建议**：将图像能力纳入 Provider/Model 配置，使用 SecureStorage 保存 key；避免新建与 Provider 体系平行的隐藏设置。

### REQ-06【高/发布阻断】Anthropic-compatible Provider 无法产生工具调用

- **位置**：`packages/core/src/model/adapters/anthropic.ts:38-52`
- **问题描述**：adapter 只处理文本 delta 和 usage，没有解析 `content_block_start` 的 `tool_use`、`input_json_delta`，也从不 emit `tool_call` chunk。
- **问题影响**：Anthropic-compatible Agent 永远无法进入工具执行循环，与 Q4 双协议兼容和 S2 工具链承诺冲突。
- **修复建议**：完整累积 Anthropic tool_use block 和 JSON 参数；在 block 完成时产生带 ID 的 tool call，并与 BP-06 的 structured tool turn 一并实现。

### REQ-07【高/发布阻断】Canvas 页面没有 taskId，真实任务产物恒不可达

- **位置**：`apps/desktop/src/renderer/src/pages/CanvasPage.tsx:4-15`、`apps/desktop/src/renderer/src/components/canvas/CanvasView.tsx:19-33`
- **问题描述**：路由页面固定渲染 `<CanvasView />`，未传 active/selected taskId；只有组件测试手工传入 taskId。
- **问题影响**：K6 任务产物已经持久化但用户页面始终只显示空态，属于入口存在、业务闭环缺失。
- **修复建议**：从路由参数或 task store 读取 taskId；TaskBoard/任务完成入口可导航到对应 Canvas；增加真实 artifact 页面集成 E2E。

### REQ-08【中】Agent 版本历史组件未挂载到任何产品入口

- **位置**：`apps/desktop/src/renderer/src/components/squad/VersionHistoryPage.tsx:14-63`、`apps/desktop/src/renderer/src/App.tsx`
- **问题描述**：L31 版本列表/回滚组件和单测存在，但 App 路由及 AgentDetailPage 均未引用。
- **问题影响**：用户无法访问版本历史和一键回滚，需求仅在孤立组件层完成。
- **修复建议**：嵌入 AgentDetailPage 或增加 `/agents/:id/history` 路由，并增加从 Agent 管理页进入、回滚后刷新配置的 E2E。

## 3.8 可维护性

### MAINT-01【中】`tasks` 写者仍与技术方案冲突

- **位置**：`apps/desktop/src/main/ipc/tasks.ts:32-35,85-108,143-175`、`daemon/cmd/jarvis-daemon/main.go:223-237`
- **问题描述**：技术方案把 tasks 分配给 daemon；本地任务由 Electron main 直接写，Multica 路径由 daemon 写。注释说明了例外，但没有技术隔离。
- **问题影响**：同一 SQLite 表存在双进程写路径，未来本地/Multica 并行时增加锁争用、状态覆盖和迁移难度。
- **修复建议**：明确唯一属主。推荐 daemon 提供本地 task API，main 只转发；过渡期至少按 task source 分区并用数据库约束/事务防止交叉更新。

### MAINT-02【低】DaemonSupervisor 的退出与重启状态存在竞态

- **位置**：`apps/desktop/src/main/daemon/DaemonSupervisor.ts:166-183,204-212`
- **问题描述**：自然退出时未将 `child` 置 null；restart 先 kill 旧进程后立即启动，新旧 exit 回调均可修改同一 healthy/cache 状态。
- **问题影响**：快速重启或异常退出后可能短暂错误显示 daemon 状态，`start()` 也可能把已退出但 `killed=false` 的 child 当作存活。
- **修复建议**：为每次 spawn 保存 generation；exit 回调仅处理当前 generation，并清空 child；restart 等待旧进程退出或超时后再启动。

### MAINT-03【低】Approval 定时器正常决议后未清理

- **位置**：`apps/desktop/src/main/approval/ApprovalCenter.ts:16-43`
- **问题描述**：每个审批创建 60 秒 timer；用户立即决议时只删除 pending，没有 clearTimeout。
- **问题影响**：高频审批下闭包和 timer 在 60 秒内无谓保留；虽然 `unref` 避免阻止退出，但仍增加资源和调试噪音。
- **修复建议**：pending record 保存 timer；resolve/timeout/窗口关闭统一走一个 finalize 方法并保证幂等清理。

### MAINT-04【中】Daemon busy 使用布尔值，无法表达并发任务

- **位置**：`daemon/cmd/jarvis-daemon/main.go:171-181`
- **问题描述**：每个任务开始设 busy=true，任一任务结束即设 false；当两个任务并发时，先完成的任务会把仍在执行的状态清空。
- **问题影响**：L39 运行模式误报 idle/registered，托盘与设置页状态不可信。
- **修复建议**：直接由 queue `ActiveTasks > 0` 推导，或使用原子引用计数；增加两个并发任务错峰结束测试。

### MAINT-05【中】生产 daemon 始终传入空本地 Injection，L38 冲突检测失效

- **位置**：`daemon/cmd/jarvis-daemon/main.go:37-51`
- **问题描述**：生产 `agentExec` 的 local 参数固定为 `acp.Injection{}`，因此本地 Skills/MCP 与 Multica 下发配置不会产生冲突。
- **问题影响**：`/runtime/conflicts` 可能长期为空，L38 冲突 UI 无真实数据。
- **修复建议**：从 main-owned settings/agent 配置获取只读 injection snapshot，经明确接口传给 daemon；增加 main 接线级冲突测试。

### MAINT-06【中】Multica client 对 registration 存在未加锁读取

- **位置**：`daemon/internal/multica/client/client.go:111-122,168-186`
- **问题描述**：Register/RegisteredID 使用 mutex，但 `serveOnce` 直接读取 `c.registration.ClientID`。当前 race suite 未覆盖该交叉路径，代码同步策略仍不一致。
- **问题影响**：重注册或并发访问时可能读取陈旧 ID，并形成潜在 data race。
- **修复建议**：`serveOnce` 统一调用 `RegisteredID()`；增加 Serve 重连与并发 ClientID 读取的 race 回归测试。

## 4. 优化建议汇总

### 4.1 立即阻断项

1. 修复主窗口导航、IPC sender 校验和 `mcp.test` 任意 spawn 链。
2. 为所有文件 IPC 建立 path capability，移除裸路径信任。
3. 将搜索 API Key 从 SQLite/导出迁入 SecureStorage，并安全迁移历史数据。
4. 移除或替换 `xlsx@0.18.5`，解析迁移到隔离进程。
5. 修复 Anthropic tool streaming 和第二轮 tool message 协议。
6. 禁止主进程 Node VM 直接执行不可信插件，限制 Multica 远程 MCP/环境注入。
7. 实现真实 pause，或在实现前移除 Pause 能力声明。
8. 修复 typecheck，并使所有质量门禁在干净环境可复现。

### 4.2 架构层面

1. 所有模型调用统一经 ModelRouter，避免 Task/Chat/Office 三套不同错误语义。
2. ToolRegistry 改为“全局定义 + 每 run 授权视图”，隔离 Agent、Plan、MCP 工具。
3. 统一 tasks 单写者；跨进程状态通过 daemon API/事件传递。
4. IPC 建立强类型契约：通道、payload、response、权限、sender origin、是否需要用户手势。
5. 文件解析、索引、大压缩包和第三方格式解析迁移到受限 worker/utility process。

### 4.3 工程实践

1. 建立可重复 CI，锁定 Node 20.11+/pnpm 9.12/Electron ABI；Node 单测和 Electron E2E 分别 rebuild 原生模块。
2. 增加 lint/format/coverage/bundle/performance budgets。
3. E2E 使用 mock Provider，覆盖 S1–S6，不以恒真测试代替旅程。
4. 对依赖设置自动审计和高危阻断；对不可达公告保留书面例外及到期日期。
5. 报告和计划中的“已完成”必须以实际主路径测试为证据，不能只依据模块或 UI 入口存在。

## 5. 单元测试专项

### 5.1 现有测试评估

- 测试文件：166 个 Vitest 文件、4 个 Playwright spec、17 个 Go test 文件。
- Core：70 files / 219 tests 全部通过。
- Protocol：2 files / 9 tests 全部通过。
- i18n：1 file / 2 tests 全部通过；`pnpm i18n:check` 通过。
- Desktop Vitest：72 files / 230 tests 通过；21 files / 157 tests 因 `better-sqlite3` ABI 不匹配失败，不能据此判定业务断言失败，但说明测试环境不可复现。
- Go：`go test ./...` 与 `go test -race ./...` 全部通过。
- Build：通过；存在主 bundle 过大和 Turbo output 配置警告。
- Typecheck：失败。
- E2E：4 passed、3 failed、3 did not run；通过项包含一个恒真 S2 占位。
- 覆盖率：未配置 provider/阈值，**无法给出可信行/分支覆盖百分比**。

### 5.2 缺失测试用例清单

1. 主窗口点击 Markdown HTTPS 链接不得导航应用窗口；远程 origin 不得调用 IPC。
2. 每个高权限 IPC 校验 senderFrame 与主窗口身份。
3. office/workspace 对未签发、过期、篡改 path capability 的拒绝。
4. 恶意/超大/zip bomb PDF、DOCX、XLSX、PPTX 的大小、超时和隔离测试。
5. 两个并发 Agent（Plan/普通、不同 MCP 绑定）的工具可见性和执行隔离。
6. OpenAI/Anthropic 两步工具调用的真实 HTTP request/response 形状与 tool ID 关联。
7. 搜索 API Key 不出现在 DB、备份、导出、日志中的全链路断言。
8. Pause 后模型、Shell、文件、MCP 均不再产生副作用；Resume 从 checkpoint 继续。
9. ModelRouter 在真实 Task/Office 路径的 429/5xx 重试、指数退避、fallback 和超时。
10. MCP 子进程无响应、退出、非法 JSON、大帧时 pending 全部释放。
11. Skills 的 `../`、绝对路径、Unicode 分隔符、符号链接和覆盖场景。
12. provider/taskboard/squad/init/ipc-subscriptions/usage stores 的成功、失败、重复初始化和双任务事件乱序。
13. PluginHost 无限循环/逃逸；Multica MCP/Env/CLI 非法注入拒绝。
14. Daemon 两任务并发 busy、重注册 ClientID race、快速 restart 和旧进程延迟 exit。
15. Canvas/VersionHistory 真实页面入口及 artifact/rollback E2E。
16. 一万任务后的 Map 数量和 heap 稳定性。
17. 真实 S1–S6：Onboarding、文件+Shell、Office、Diff Accept、Squad、Multica 流回传。
18. 100k chat_messages 的 FTS 查询 `<100ms` 与冷启动 `<3s` 性能回归。

### 5.3 覆盖率提升方案

1. 第一阶段：补齐测试环境和 typecheck，确保所有现有测试在 Node/Electron 两种 ABI 下可复现。
2. 第二阶段：接入 V8 coverage，优先主进程安全边界、TaskOrchestrator、ModelRouter 和 renderer stores。
3. 第三阶段：以 S1–S6 建立 Electron E2E，mock Provider/MCP/Multica，避免外网和真实密钥依赖。
4. 第四阶段：引入 race、资源泄漏、恶意文件、性能和长期运行测试，并将指标加入发布门禁。

## 6. 验证记录

| 命令 | 结果 |
|---|---|
| `npx pnpm@9.12.0 build` | 通过；renderer 主 bundle 约 2.37 MB；Turbo 报 output 配置警告 |
| `npx pnpm@9.12.0 typecheck` | 失败；Core spec 共 4 个类型错误 |
| `npx pnpm@9.12.0 test` | Core/Protocol/i18n 通过；Desktop 157 项因 better-sqlite3 Node ABI 不匹配失败 |
| `npx pnpm@9.12.0 i18n:check` | 通过 |
| `go test ./...` | 通过 |
| `go test -race ./...` | 通过 |
| `npx pnpm@9.12.0 --dir apps/desktop e2e` | 4 passed / 3 failed / 3 未运行 |
| `npx pnpm@9.12.0 audit --prod --json` | 260 个生产依赖；0 critical、3 high，其中 2 个 xlsx 漏洞在业务路径可达 |

测试限制：

- 当前 `better-sqlite3` 先前按 Electron ABI 128 构建，而 Node 运行时需要 ABI 137，因此 Desktop Vitest 的数据库用例被环境阻断。
- E2E renderer 缺少 Playwright Chromium；Electron 项目即使在非 sandbox 环境仍出现 `Process failed to launch`。
- Sonatype 依赖服务认证后仍拒绝查询，因此依赖结论以 pnpm/npm advisory 数据为准。

## 7. 总结与后续行动

### 7.1 遗留风险

- 主窗口与 preload 的信任边界可被远程导航突破。
- renderer 到 main 的文件能力没有 capability 或 sender origin 双重约束。
- 搜索 API Key 已明文进入持久化和导出路径。
- 高危文档解析依赖运行在最高价值进程。
- Provider 工具协议不完整，Plugin/Multica 注入缺少可信执行边界。
- 用户可见的 Pause、视频摘要、MCP transport、URL Skills、Canvas 等能力与实际行为不一致。
- 当前分支类型检查、单测环境和 E2E 均未形成可发布证据。
- tasks 双写者和共享 ToolRegistry 会放大后续并发/Multica 迭代成本。

### 7.2 是否可以合入

**否。**

至少 SEC-01、SEC-02、SEC-03、SEC-07、SEC-08、SEC-09、BP-01、BP-06、BP-07、TEST-01、REQ-06、REQ-07 必须在合入前修复并补回归测试。REQ-01/REQ-02 若无法在本次版本实现，应由产品明确降级范围并同步 Wiki、UI 和发布说明，不能保留“已实现”状态。

### 7.3 建议行动顺序

1. **P0 安全止血**：SEC-01 → SEC-02 → SEC-07 → SEC-03 → SEC-08 → SEC-09 → SEC-04。
2. **P0 行为正确性**：BP-06、REQ-06、BP-01、BP-07、BP-02、BP-03。
3. **P0 质量门禁**：TEST-01、可复现 Desktop Vitest、真实 Electron E2E。
4. **P1 需求收敛**：Canvas、D9、MCP SSE/HTTP、URL Skills、D10 配置、VersionHistory、Provider 文档。
5. **P1 架构与性能**：tasks 单写者、任务资源回收、解析进程隔离、bundle 和冷启动预算。

---

本报告针对 2026-08-06 评审时的当前工作树生成。工作树包含大量未提交文件，后续修改后应重新运行安全链验证、全量类型检查、单元测试、Go race、依赖审计和真实 Electron E2E。
