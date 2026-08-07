# JARVIS

**面向个人办公的跨平台本地 AI Agent 桌面工作台**

JARVIS 是一款 **本地优先（local-first）** 的 AI 助手桌面应用：对话、任务执行、编程辅助、办公增强与多 Agent 协作统一在一个 Electron 应用中完成。数据默认保存在本机，API Key 经系统密钥链加密存储，不采集遥测、不做云端同步。

> **JARVIS** — *Your local AI workbench for chat, agents, coding, and office workflows.*

[![Node](https://img.shields.io/badge/node-%3E%3D20.11-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-9.12-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Electron](https://img.shields.io/badge/Electron-32-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Go](https://img.shields.io/badge/Go-1.25-00ADD8?logo=go&logoColor=white)](https://go.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)

---

## 目录

- [特性](#特性)
- [架构概览](#架构概览)
- [技术栈](#技术栈)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [开发指南](#开发指南)
- [测试](#测试)
- [项目结构](#项目结构)
- [本地数据与路径](#本地数据与路径)
- [安全与隐私](#安全与隐私)
- [文档](#文档)
- [贡献](#贡献)

---

## 特性

### 对话与 Agent

- **多会话聊天**：流式回复、Markdown 渲染、代码高亮、图片附件
- **工具步骤可视化**：工具调用过程以 StepCard 卡片流展示
- **可配置 Agent**：自定义系统提示词、模型绑定、上下文预算、Plan-only 模式
- **Agent 模板库**：从预设快速创建办公、编程等场景 Agent

### 任务与协作

- **REACT 任务引擎**：文件读写、Shell 执行等工具链，带沙箱策略与审批门
- **任务看板**：六列 Kanban 管理任务生命周期
- **Squad 多 Agent**：Leader 委派、时间线、调用图、审批面板
- **工作流编辑器**：DAG 可视化编排与运行
- **画布**：展示任务产物与协作输出

### 编程辅助

- 工作区文件树、Diff 查看、@ 提及选择器
- 轻量编程 UI（非完整 IDE，无 Monaco）

### 办公增强

- 写作、PDF 阅读与摘要、Composer 草稿区
- 提示词模板、联网搜索源配置
- 网页 / 视频 / 图像生成摘要
- 全局 FTS 搜索（消息、Agent、任务）
- 划词浮动菜单（翻译、解释、摘要、搜索）

### 设置与运维

- **Provider 管理**：OpenAI 兼容 / Anthropic 双协议，用户自定义模型 ID（无硬编码模型）
- **MCP 服务**、**Skills**、**权限沙箱**、**并发控制**
- **Go Daemon**：任务调度、Multica 运行时对接（注册、心跳、接单）
- **数据安全**：本地备份、擦除、纯本地策略声明
- **配置导入导出**、快捷键、Token 统计、审计日志
- **国际化**：简体中文 / English 对称，`pnpm i18n:check` 门禁

### UI

- 基于 **Codex 风格** 的设计系统（`@jarvis/ui`）
- 统一 App Shell：侧栏导航 + 顶栏 Agent 切换 + 任务控制条
- 浅色 / 深色 / 跟随系统主题

---

## 架构概览

JARVIS 采用五层架构，自底向上：

```
┌─────────────────────────────────────────────────────────────┐
│  Electron Renderer (React 19 + react-router-dom + zustand)   │
│  pages / components / stores / i18n                         │
├─────────────────────────────────────────────────────────────┤
│  Electron Main + IPC (better-sqlite3, DaemonSupervisor)     │
│  IpcRouter · SecureStorage · migrations                     │
├─────────────────────────────────────────────────────────────┤
│  packages/core — AgentEngine / ModelRouter / ToolRegistry    │
│  REACT loop · MCP · Sandbox · Squad · Office · Coding       │
├─────────────────────────────────────────────────────────────┤
│  Go daemon (jarvis-daemon) — 调度队列 · HTTP API · Multica   │
├─────────────────────────────────────────────────────────────┤
│  SQLite (WAL) — ~/.jarvis/jarvis.db                         │
└─────────────────────────────────────────────────────────────┘
```

**引擎归属（决策 A）**：`AgentEngine`、REACT 循环、`ModelRouter`、`MCPClient` **仅在 `packages/core`（TypeScript）中实现一次**。Go `jarvis-agent` 为瘦协议壳；Multica 路径通过内嵌 Node 执行同一 TS 引擎。本地任务在 Electron 主进程内运行 TS 引擎，Daemon 负责调度与队列。

**IPC 约定**：Renderer 经 `window.jarvis.invoke` / `onDidReceive` 与 Main 通信；通道名与类型定义在 `packages/protocol`。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面壳 | Electron 32、electron-vite |
| 前端 | React 19、react-router-dom、zustand、react-i18next |
| UI | `@jarvis/ui`（Design tokens + 组件库） |
| 引擎 | TypeScript、`packages/core` |
| 运行时 | Go 1.25+（`daemon/`） |
| 数据库 | SQLite WAL、better-sqlite3（Main 进程） |
| 构建 | pnpm workspaces、Turborepo |
| 测试 | Vitest、Playwright（单元 / E2E / 功能回归） |

---

## 环境要求

- **Node.js** ≥ 20.11
- **pnpm** 9.12（见根目录 `packageManager` 字段）
- **Go** ≥ 1.22（构建 Daemon 时需要）
- **macOS / Linux / Windows**（Electron 跨平台；部分能力如 Keychain 因平台而异）

---

## 快速开始

### 1. 克隆与安装

```bash
git clone https://github.com/baofengbaofeng/Jarvis.git
cd Jarvis
pnpm install
```

### 2. 构建 Go Daemon（桌面应用启动依赖）

```bash
cd apps/desktop
pnpm build:daemon
```

产物路径：`apps/desktop/resources/daemon/jarvis-daemon`（已被 `.gitignore` 忽略，需本地编译）。

### 3. 启动开发环境

```bash
# 在 apps/desktop 目录
pnpm rebuild:electron   # 将 better-sqlite3 编译为 Electron ABI
pnpm dev
```

应用默认在 `127.0.0.1` 加载 Vite 开发服务器。首次启动会进入 **Onboarding** 引导配置 Provider 与 Agent。

### 4. 生产构建

```bash
# 仓库根目录
pnpm build

# 或仅构建桌面端
cd apps/desktop && pnpm build
```

---

## 开发指南

### Monorepo 常用命令

在仓库根目录执行：

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 各 workspace 并行开发（Turbo） |
| `pnpm build` | 全量构建 |
| `pnpm test` | 全量单元测试 |
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm i18n:check` | 校验 zh-CN / en 文案键对称（UI 改动必跑） |

### 桌面端专项

```bash
cd apps/desktop

pnpm dev              # Electron 开发模式
pnpm test             # Renderer + Main 单元测试（Vitest）
pnpm e2e              # Playwright E2E
pnpm build:daemon     # 编译 Go daemon
pnpm rebuild:electron # Electron ABI 下重建 better-sqlite3
pnpm rebuild:node     # 系统 Node ABI 下重建（跑 vitest 前）
```

> **注意**：`better-sqlite3` 是原生模块，Electron ABI 与系统 Node ABI 不同。跑 `pnpm dev` 前用 `rebuild:electron`；跑 `pnpm test` 前用 `rebuild:node`，**不要混用**。

### Go Daemon

```bash
cd daemon
go build ./...
go test ./...
```

Daemon HTTP 默认监听 `127.0.0.1:17890`。

### 新增功能的一般路径

1. 纯逻辑 → `packages/core` + `*.spec.ts`
2. IPC 通道与类型 → `packages/protocol`
3. Main 持久化与 handler → `apps/desktop/src/main`
4. Zustand store + 页面组件 → `apps/desktop/src/renderer`
5. 文案 → `packages/i18n/locales/{zh-CN,en}/common.json`
6. 可复用 UI → `packages/ui`

Renderer **必须**从 `@jarvis/core/renderer` 导入纯模块，**不得**引用完整 `@jarvis/core` barrel（含 Node 依赖）。

---

## 测试

```bash
# 全量单元测试
pnpm test

# i18n 门禁
pnpm i18n:check

# 桌面 Renderer 测试
cd apps/desktop && pnpm vitest run src/renderer

# Core 引擎测试
cd packages/core && pnpm test

# V1.0 功能回归（Playwright + Electron）
pnpm test:functional
```

功能测试套件说明见 [`test/V1.0/README.md`](test/V1.0/README.md)。

---

## 项目结构

```
Jarvis/
├── apps/
│   └── desktop/          # Electron 应用（main / preload / renderer）
├── packages/
│   ├── core/             # Agent 引擎、工具、沙箱、Squad、Office 等
│   ├── protocol/         # IPC 通道名与共享类型
│   ├── ui/               # Design system 组件与 tokens
│   ├── i18n/             # 国际化资源
│   └── views/            # 脚手架（页面目前在 desktop renderer）
├── daemon/               # Go 运行时（jarvis-daemon / jarvis-agent）
├── docs/                 # 实现计划与设计规格
├── wiki/                 # 产品 / 技术 / 需求文档（HTML）
├── test/                 # 功能回归与测试辅助
├── scripts/              # i18n-check 等脚本
├── package.json          # 根 workspace 脚本
├── pnpm-workspace.yaml
└── turbo.json
```

---

## 本地数据与路径

| 路径 | 用途 |
|------|------|
| `~/.jarvis/jarvis.db` | 主 SQLite 数据库（WAL） |
| `~/.jarvis/backups/` | 配置备份 |
| `~/.jarvis/logs/` | 运行日志 |
| `~/.jarvis/workspaces/{taskId}/` | 任务隔离工作区 |
| 项目内 `.jarvis/` | 工作区上下文元数据 |

可通过环境变量 `JARVIS_DATA_DIR` 覆盖数据目录（测试与 CI 中使用）。

---

## 安全与隐私

- **本地优先**：无遥测、无云端账号同步；`local_only` 为声明性策略开关
- **密钥安全**：API Key 仅存系统密钥链（SecureStorage），磁盘配置仅保留 `apiKeyRef`
- **沙箱**：按 Agent 配置工具权限；敏感操作可走审批门（ApprovalGate）
- **配置导出**：支持 `skip | overwrite | merge` 策略，校验 `schemaVersion`
- **禁止硬编码模型 ID**：Provider 与模型均由用户自行配置

---

## 文档

| 文档 | 说明 |
|------|------|
| [`CLAUDE.md`](CLAUDE.md) | 仓库开发约定与架构速查（面向 AI / 贡献者） |
| [`apps/desktop/README.md`](apps/desktop/README.md) | 桌面端 native 模块与 Daemon 构建说明 |
| [`wiki/`](wiki/) | 产品、技术、需求文档 V1.0 |
| [`docs/superpowers/plans/`](docs/superpowers/plans/) | M0–M8 分里程碑实现计划 |
| [`docs/superpowers/specs/`](docs/superpowers/specs/) | UI 设计系统等规格 |
| [`test/V1.0/README.md`](test/V1.0/README.md) | V1.0 功能测试矩阵 |

---

## 贡献

1. Fork 本仓库并创建功能分支（建议命名：`cursor/<description>-<id>` 或常规 `feat/...`）
2. 小步提交，信息前缀使用 `feat:` / `fix:` / `test:` / `refactor:`
3. UI 改动须同时更新 **zh-CN** 与 **en** 文案，并通过 `pnpm i18n:check`
4. 为新逻辑补充 Vitest 用例；涉及 IPC 或端到端流程时考虑 Playwright 覆盖
5. 提交 Pull Request 并说明变更范围与测试情况

开发前建议阅读 [`CLAUDE.md`](CLAUDE.md) 中的 Global Constraints（Q4 自定义模型、单写者表、V1.0 排除项等）。

---

## 许可证

本仓库当前为 **private** monorepo，根目录尚未附带开源许可证文件。使用与分发前请联系项目维护者确认授权范围。

---

<p align="center">
  <sub>Built with local-first principles — your data stays on your machine.</sub>
</p>
