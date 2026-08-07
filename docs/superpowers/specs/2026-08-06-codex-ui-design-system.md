# JARVIS Desktop：Codex 风格 UI 与 `packages/ui` Design System

日期：2026-08-06  
状态：设计已确认，待写实现计划

## 1. 目标

为桌面端做一次**全应用视觉翻新**，主参考 **OpenAI Codex 对话工作台**（宽内容区、轻分隔、步骤卡片化），而非 Cursor 式 IDE 密度。

同时把视觉与交互 primitives **沉淀到 `packages/ui`**，desktop renderer 只负责路由、stores、i18n 与业务编排。默认主题为**浅色**；深色为完整第二套，语义对齐。

| 要做 | 不做 |
|------|------|
| 统一 App Shell + 全路由套壳 | 改 Agent 引擎 / 流式协议 / IPC 语义 |
| Design tokens（浅/深）+ ui 组件 API | 新功能、新路由、Monaco/完整 IDE |
| Chat 消息流 / Composer / StepCard 呈现 | 像素级复制 Codex 品牌资产 |
| Settings 与其余业务页视觉对齐 | 本轮抽离 `packages/views` |
| 替换无效 Tailwind-like `className` 与裸控件堆 | 全局快捷键、自动更新等 1.0.0-Preview 排除项 |

## 2. 已确认的决策

1. **范围**：全应用（C）——聊天、设置、Agents、Coding、Office、Squad、Board、Workflow、Canvas 及全局浮层。
2. **视觉主参考**：Codex（B）——对话工作台；工具步骤卡片化；产品感强于 IDE。
3. **主题**：默认浅色；浅/深两套均按 Codex 风格做全；保留 `light` / `dark` / `system` 能力（`system` 解析后落到浅或深）。
4. **信息架构**：统一 App Shell（A）——左侧全局导航 + 顶栏上下文 + 主内容 `Outlet`。
5. **实现路径**：方案 3——正式 design system 落在 `packages/ui`；desktop 消费组件，不在各页散落设计真相。
6. **交付**：同一设计、分阶段落地（P0→P3），可多 PR；令牌与 Shell 必须先于页面精修。

## 3. 背景与约束

### 3.1 现状

- Renderer 约 70 个非测试 `.tsx`，样式以 **inline style** 为主；`globals.css` 仅 4 个变量。
- 部分文件含 Tailwind 风格 `className`，但仓库**未安装 Tailwind**，这些 class 无效。
- `packages/ui` / `packages/views` 仍为脚手架（版本常量）；页面全部在 `apps/desktop/src/renderer`。
- 产品 Wiki 曾写「豆包风格」主聊天；本设计**显式改为 Codex 工作台气质**（产品文档后续可另开任务同步，不阻塞实现）。

### 3.2 硬约束

- UI 文案 zh-CN / en 对称；`pnpm i18n:check` 必须通过；无硬编码用户可见字符串。
- Renderer 只从 `@jarvis/core/renderer` 取纯模块（若 ui 包被 renderer 引用，ui 自身不得引入 Node 专用 core）。
- `packages/ui` **不得**依赖 `@jarvis/core`、Electron IPC、zustand stores。
- 冷启动目标（&lt;3s）不因 UI 包引入明显回退；避免超重运行时 UI 框架。
- CSP：`default-src 'self'; style-src 'self' 'unsafe-inline'`——样式方案须兼容（组件 CSS / 构建期注入均可；勿依赖外链字体 CDN）。
- 开发态 Vite 主机为 `127.0.0.1`（TrustedRendererPolicy）；样式方案不得改回 `localhost`。

## 4. 视觉语言与令牌

### 4.1 气质

- 宽内容区、少描边、轻分隔；表面层级靠背景阶而非厚阴影。
- 消息与工具步骤以分组/卡片呈现；强调色克制，仅用于焦点与主操作。
- **禁止**默认落到：紫靛渐变主题、暖奶油+衬线+陶土强调、报纸密排、多阴影光晕、圆角胶囊堆、emoji 装饰。
- 字体：`--font-sans` 使用策展栈（如 `"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`），`--font-mono` 使用等宽策展栈。禁止 Inter / Roboto / Arial 作为主字体。若引入自定义字体文件，必须**本地打包**（禁 CDN）。

### 4.2 Token 集（CSS 变量）

浅色为默认写在 `:root` / `[data-theme='light']`；深色在 `[data-theme='dark']`。  
**强调色**：中性墨蓝/石板蓝（非紫色系）；具体色值在 P0 令牌文件中写死并附浅/深对照。  
**默认主题**：`ThemeProvider` / settings 默认值改为 `light`（用户仍可选 `dark` / `system`）。

| 类别 | 变量（最小集） |
|------|----------------|
| 表面 | `--bg`, `--surface`, `--surface-raised`, `--border`, `--border-subtle` |
| 文字 | `--fg`, `--fg-muted`, `--fg-faint` |
| 强调 | `--accent`, `--accent-fg`（墨蓝/石板蓝，见上） |
| 状态 | `--success`, `--warning`, `--danger`, `--info` |
| 间距 | `--space-1` … `--space-6`（4px 步进或等价） |
| 圆角 | `--radius-sm`, `--radius-md`, `--radius-lg` |
| 字号 | `--text-xs` … `--text-xl` |
| 字体 | `--font-sans`, `--font-mono` |

`ThemeProvider`（desktop）继续设置 `document.documentElement` 的 `data-theme`；令牌 CSS 由 `@jarvis/ui` 导出并在 renderer 入口导入一次。

## 5. App Shell 与导航

### 5.1 布局

```
┌────────┬──────────────────────────────┐
│ Brand  │  TopBar: Agent · 会话 · 任务态 │
│ ─────  │──────────────────────────────│
│ Nav    │                              │
│        │        Main (Outlet)         │
│ ─────  │                              │
│ 设置   │                              │
└────────┴──────────────────────────────┘
```

### 5.2 全局导航分组

| 分组 | 路由 |
|------|------|
| 工作 | `/` 对话、`/agents` Agent、`/coding` 代码、`/office` 办公 |
| 协作 | `/squad`、`/board`、`/workflow`、`/canvas` |
| 底部固定 | `/settings`（进入后右侧保留 Settings 子导航） |

- 会话列表留在**对话页内**（可折叠次级栏），不进入全局 Nav。
- 去掉各页「跳转按钮墙」；跨页导航只走 Shell。
- **Onboarding** 全屏、不套 Shell。
- 全局浮层（Approval、Toast、SelectionMenu）仍挂在应用根，视觉改用 ui primitives。

### 5.3 顶栏

当前 Agent 切换、会话上下文（标题/新建，在对话相关页显示）、任务控制（与现有 TaskControlBar 能力对齐）。状态来源仍为现有 stores / IPC。

## 6. 对话 / Agent 主表面

### 6.1 结构

主内容区内：可选会话列表（左）+ 居中限宽消息流（约 720–800px）+ 底部 Composer。

### 6.2 呈现

- 用户消息：轻底/轻对齐；助手：全宽内容块。
- 工具调用、审批、任务事件 → `StepCard`（标题、状态点、可展开详情）；Codex 步骤卡气质，非 IDE 终端堆。
- Markdown：正文走令牌；代码块 `--surface-raised` + mono；浅/深各一套语法高亮（替换写死的 Prism `oneDark`）。

### 6.3 Composer

圆角多行输入 + 发送；发送中禁用并与顶栏 running 态一致。已有附件/模式能力则挂在输入区上方轻量工具条，本轮不新造协议。

## 7. `packages/ui` 边界与组件清单

### 7.1 边界

| 允许 | 禁止 |
|------|------|
| React 展示组件、令牌 CSS、无障碍基础属性 | `@jarvis/core`、Electron、IPC、zustand |
| 可选：构建期 Tailwind（或等价）仅作实现细节 | 业务文案硬编码（调用方传 `children` / 标签） |
| workspace 导出供 desktop / 测试使用 | 依赖浏览器外 Node API |

对外以**组件 API** 为主；调用方不直接拼业务页的 utility 海洋。

### 7.2 首批组件（P0–P1）

`Button`, `Input`, `Textarea`, `Panel`, `AppShell`, `Sidebar`, `TopBar`, `NavItem`, `NavGroup`, `MessageBubble`, `StepCard`, `Composer`, `Tabs`, `Modal`, `Toast`（或 Toast 视图壳）。

桌面侧：`AppLayout` 接线路由与 store；页面逐步删除 inline 样式。

### 7.3 `packages/views`

本轮**不**迁页面到 `packages/views`；保持脚手架。

## 8. 其余页面策略

同一 Shell + 令牌下：

| 区域 | 策略 |
|------|------|
| Settings | 保留子路由；分组列表 + 表单密度对齐 Codex 设置感 |
| Agents / Templates | 列表/详情用 Panel + 表格/行组件 |
| Coding / Office | 换表面与工具条样式；不改 K3 降级范围（无 Monaco） |
| Squad / Board / Workflow / Canvas | 先壳与空状态/卡片，再微调；功能与数据结构不变 |
| 浮层 | Approval / Toast / SelectionMenu 统一 primitives |

## 9. 分期交付

| 阶段 | 内容 | 完成定义 |
|------|------|----------|
| **P0** | `@jarvis/ui` 包骨架、令牌 CSS、基础 primitives、`AppShell` 接入、`App.tsx` 路由套壳、默认浅色 | 任意已有页在壳内可导航；浅/深切换可见 |
| **P1** | Chat 消息流、Composer、StepCard、会话次级栏、Markdown 主题 | 主对话路径视觉达 Codex 工作台水平 |
| **P2** | Settings 全套子页 | 设置区无裸 HTML 表单堆 |
| **P3** | 其余业务页 + 浮层；清除残留 inline / 无效 className | 全路由视觉一致；相关测试与 i18n 绿 |

每阶段独立可合并；不得在 P0 未完成前大面积改业务页样式（避免双系统并存过久）。

## 10. 测试与验收

- `packages/ui`：组件 smoke / 可访问性基础（角色、焦点）单元测试（vitest + testing-library，与仓库一致）。
- desktop：现有页面 spec 更新选择器如有破坏；不强制视觉回归截图（除非后续另开）。
- 门禁：`pnpm i18n:check`、受影响包 `typecheck` / `test`。
- 手工：`apps/desktop` 下 `pnpm rebuild:electron && pnpm build:daemon && pnpm dev`，确认无 `IPC_UNTRUSTED_ORIGIN`，浅/深切换，主路径聊天与设置可点。

## 11. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 全应用一次改完过大 | 强制 P0→P3；P0 只建系统与壳 |
| ui 包拖慢冷启动 | 避免巨型运行时依赖；按需导出；测启动 |
| 与 Wiki「豆包」描述不一致 | 实现按本 spec；Wiki 同步另任务 |
| CSP / 字体 | 本地字体或系统栈子集；不外链 |
| 假 Tailwind class 残留 | P3 专门清扫清单 |

## 12. 实现计划入口

本文件批准后，使用 writing-plans 产出分阶段实现计划（建议一份总计划或按 P0–P3 拆分），再按 TDD / subagent-driven 执行。
