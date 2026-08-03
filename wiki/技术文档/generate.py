#!/usr/bin/env python3
"""Generate JARVIS technical design document HTML."""

from pathlib import Path

OUTPUT = Path(__file__).parent / "JARVIS技术方案_V1.0_20260802.html"

HEAD = """<!DOCTYPE html>
<html lang="zh-CN" data-doc-type="technical" data-doc-version="1.0-mvp" data-doc-date="2026-08-02" data-project="JARVIS">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="JARVIS 桌面端 AI 助手 V1.0-MVP 技术方案 — 系统架构、模块设计、接口协议与实现细节">
  <meta name="author" content="JARVIS Project">
  <meta name="keywords" content="JARVIS,技术方案,架构设计,Electron,Go,Multica,MCP">
  <title>JARVIS 技术方案 V1.0-MVP (2026-08-02)</title>
  <style>
    :root {
      --bg: #f8f9fb; --surface: #fff; --border: #e2e8f0;
      --text: #1e293b; --text-muted: #64748b; --primary: #2563eb;
      --primary-light: #eff6ff; --accent: #0f766e; --warn: #b45309;
      --sidebar-w: 280px; --radius: 8px;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      --mono: "SF Mono", "Fira Code", Consolas, monospace;
    }
    [data-theme="dark"] {
      --bg: #0f172a; --surface: #1e293b; --border: #334155;
      --text: #f1f5f9; --text-muted: #94a3b8; --primary: #60a5fa;
      --primary-light: #1e3a5f; --accent: #2dd4bf;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; font-size: 15px; }
    body { font-family: var(--font); background: var(--bg); color: var(--text); line-height: 1.7; }
    a { color: var(--primary); text-decoration: none; }
    a:hover { text-decoration: underline; }
    code, pre { font-family: var(--mono); font-size: 0.88em; }
    pre { background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 1rem; overflow-x: auto; margin: 1rem 0; }
    code { background: var(--bg); padding: 0.15em 0.4em; border-radius: 4px; }
    pre code { background: none; padding: 0; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.92em; }
    th, td { border: 1px solid var(--border); padding: 0.55rem 0.75rem; text-align: left; vertical-align: top; }
    th { background: var(--primary-light); font-weight: 600; white-space: nowrap; }
    tr:nth-child(even) { background: rgba(0,0,0,0.02); }
    [data-theme="dark"] tr:nth-child(even) { background: rgba(255,255,255,0.03); }
    h1,h2,h3,h4 { line-height: 1.35; margin: 1.5rem 0 0.75rem; }
    h1 { font-size: 1.75rem; } h2 { font-size: 1.4rem; border-bottom: 2px solid var(--primary); padding-bottom: 0.35rem; }
    h3 { font-size: 1.15rem; color: var(--accent); } h4 { font-size: 1rem; }
    p, ul, ol { margin: 0.6rem 0; }
    ul, ol { padding-left: 1.5rem; }
    li { margin: 0.25rem 0; }
    .banner { background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 60%, #0f766e 100%); color: #fff; padding: 1.75rem 2rem; }
    .banner-inner { max-width: 1400px; margin: 0 auto; }
    .banner h1 { color: #fff; border: none; margin: 0 0 0.5rem; font-size: 2rem; }
    .banner-meta { display: flex; flex-wrap: wrap; gap: 1rem; font-size: 0.88em; opacity: 0.92; margin-top: 0.75rem; }
    .banner-meta span { background: rgba(255,255,255,0.15); padding: 0.2rem 0.65rem; border-radius: 999px; }
    .banner-desc { max-width: 900px; margin-top: 0.75rem; opacity: 0.95; font-size: 0.95em; }
    .toolbar { display: flex; gap: 0.5rem; margin-top: 1rem; flex-wrap: wrap; }
    .toolbar button { background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.35); color: #fff; padding: 0.35rem 0.85rem; border-radius: 6px; cursor: pointer; font-size: 0.85em; }
    .toolbar button:hover { background: rgba(255,255,255,0.3); }
    .layout { display: flex; max-width: 1400px; margin: 0 auto; min-height: calc(100vh - 200px); }
    .sidebar { width: var(--sidebar-w); flex-shrink: 0; position: sticky; top: 0; height: 100vh; overflow-y: auto; background: var(--surface); border-right: 1px solid var(--border); padding: 1.25rem 0; }
    .sidebar-title { font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); padding: 0 1.25rem; margin-bottom: 0.5rem; }
    .toc { list-style: none; padding: 0; }
    .toc li { margin: 0; }
    .toc a { display: block; padding: 0.35rem 1.25rem; font-size: 0.88em; color: var(--text-muted); border-left: 3px solid transparent; }
    .toc a:hover, .toc a.active { color: var(--primary); background: var(--primary-light); border-left-color: var(--primary); text-decoration: none; }
    .toc .toc-l2 a { padding-left: 2rem; font-size: 0.84em; }
    .content { flex: 1; padding: 2rem 2.5rem 4rem; min-width: 0; background: var(--surface); }
    section { margin-bottom: 2.5rem; scroll-margin-top: 1rem; }
    section > .section-id { font-family: var(--mono); font-size: 0.75em; color: var(--text-muted); margin-bottom: 0.25rem; }
    .badge { display: inline-block; font-size: 0.75em; padding: 0.15em 0.55em; border-radius: 999px; font-weight: 600; margin-left: 0.35rem; vertical-align: middle; }
    .badge-in { background: #dcfce7; color: #166534; }
    .badge-out { background: #fee2e2; color: #991b1b; }
    .badge-p0 { background: #dbeafe; color: #1e40af; }
    [data-theme="dark"] .badge-in { background: #14532d; color: #86efac; }
    [data-theme="dark"] .badge-out { background: #7f1d1d; color: #fca5a5; }
    .callout { border-left: 4px solid var(--primary); background: var(--primary-light); padding: 0.85rem 1.1rem; border-radius: 0 var(--radius) var(--radius) 0; margin: 1rem 0; font-size: 0.93em; }
    .callout-warn { border-left-color: var(--warn); background: #fffbeb; }
    [data-theme="dark"] .callout-warn { background: #422006; }
    .diagram { background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.25rem; font-family: var(--mono); font-size: 0.82em; white-space: pre; overflow-x: auto; line-height: 1.5; }
    .ai-block { border: 1px dashed var(--border); border-radius: var(--radius); padding: 1rem; margin: 1rem 0; background: var(--bg); }
    .ai-block summary { cursor: pointer; font-weight: 600; font-size: 0.88em; color: var(--text-muted); }
    .ai-block pre { margin: 0.75rem 0 0; font-size: 0.8em; }
    footer.doc-footer { text-align: center; padding: 1.5rem; color: var(--text-muted); font-size: 0.82em; border-top: 1px solid var(--border); }
    @media (max-width: 900px) { .layout { flex-direction: column; } .sidebar { width: 100%; height: auto; position: relative; max-height: 40vh; } .content { padding: 1.25rem; } }
    @media print { .sidebar, .toolbar { display: none; } .content { padding: 0; } .banner { background: #1e3a5f; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style>
</head>
<body data-theme="light">

<script type="application/ld+json" id="doc-metadata">
{
  "@context": "https://schema.org",
  "@type": "TechArticle",
  "name": "JARVIS 技术方案 V1.0-MVP",
  "version": "1.0-mvp",
  "datePublished": "2026-08-02",
  "description": "JARVIS 跨平台桌面 AI Agent 平台 V1.0-MVP 技术方案",
  "about": { "@type": "SoftwareApplication", "name": "JARVIS", "applicationCategory": "DesktopApplication", "operatingSystem": "macOS, Windows" },
  "keywords": ["技术方案", "Electron", "Go", "Multica", "MCP", "Agent"]
}
</script>

<header class="banner" id="top" role="banner">
  <div class="banner-inner">
    <h1>JARVIS 技术方案文档</h1>
    <p class="banner-desc">
      基于《JARVIS 需求文档 V1.0-MVP》《JARVIS 产品文档 V1.0-MVP》及《产品原型 V1.0》转化的
      详细技术方案。定义系统架构、模块划分、数据模型、接口协议、核心子系统实现、
      安全策略与分阶段技术交付计划，作为 V1.0-MVP 阶段研发与 AI 辅助编码的统一技术基线。
    </p>
    <div class="banner-meta">
      <span>版本 V1.0-MVP</span>
      <span>日期 2026-08-02</span>
      <span>语言 zh-CN / en</span>
      <span>状态 技术方案</span>
      <span>平台 macOS / Windows</span>
      <span>技术栈 Go + TS + Electron</span>
    </div>
    <div class="toolbar">
      <button type="button" id="btn-theme">切换主题</button>
      <button type="button" id="btn-expand-toc">展开目录</button>
      <button type="button" id="btn-print">打印 / 导出 PDF</button>
    </div>
  </div>
</header>

<div class="layout">
  <nav class="sidebar" id="sidebar" aria-label="文档目录">
    <div class="sidebar-title">目录 Navigation</div>
    <ul class="toc" id="toc-list"></ul>
  </nav>
  <main class="content" id="main-content" role="main">
"""

FOOT = """
  </main>
</div>

<footer class="doc-footer">
  JARVIS Project &copy; 2026 &mdash; 技术方案 V1.0-MVP &mdash; 最后更新 2026-08-02
  &mdash; 依据：需求文档 / 产品文档 / 产品原型 V1.0
</footer>

<script>
(function () {
  'use strict';
  document.getElementById('btn-theme').addEventListener('click', function () {
    var body = document.body;
    var next = body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    body.setAttribute('data-theme', next);
    try { localStorage.setItem('jarvis-doc-theme', next); } catch (e) {}
  });
  try {
    var saved = localStorage.getItem('jarvis-doc-theme');
    if (saved) document.body.setAttribute('data-theme', saved);
  } catch (e) {}
  document.getElementById('btn-print').addEventListener('click', function () { window.print(); });
  var main = document.getElementById('main-content');
  var tocList = document.getElementById('toc-list');
  var headings = main.querySelectorAll('section > h2, section > h3');
  var html = '';
  headings.forEach(function (h) {
    var id = h.closest('section').id;
    if (!id) return;
    var cls = h.tagName === 'H3' ? 'toc-l2' : '';
    html += '<li class="' + cls + '"><a href="#' + id + '">' + h.textContent + '</a></li>';
  });
  tocList.innerHTML = html;
  var sections = main.querySelectorAll('section[id]');
  var links = tocList.querySelectorAll('a');
  function onScroll() {
    var current = '';
    sections.forEach(function (s) {
      if (s.getBoundingClientRect().top <= 120) current = s.id;
    });
    links.forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('href') === '#' + current);
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  document.getElementById('btn-expand-toc').addEventListener('click', function () {
    document.querySelectorAll('details.ai-block').forEach(function (d) { d.open = true; });
  });
})();
</script>
</body>
</html>
"""

SECTIONS = []

def sec(section_id, section_type, title, body):
    SECTIONS.append(f"""
    <section id="{section_id}" data-section-type="{section_type}">
      <div class="section-id">{title.split('.')[0] if '.' in title[:4] else section_id}</div>
      <h2>{title}</h2>
      {body}
    </section>""")

# §1 Overview
sec("sec-01-overview", "overview", "1. 文档概述", """
      <h3 id="sec-01-1-purpose">1.1 文档目的</h3>
      <p>本文档将需求与产品方案转化为可落地的<strong>技术实现规格</strong>，用于：</p>
      <ul>
        <li>确定系统分层、进程模型、Monorepo 结构与模块边界</li>
        <li>定义核心数据模型、IPC/API 协议、Task 状态机与 Agent 执行管线</li>
        <li>将 A–L 能力 ID 映射到具体技术组件与实现路径</li>
        <li>将 50 个产品原型界面映射到前端路由与组件树</li>
        <li>指导 MVP → V1.0 分 Milestone 的技术交付与验收</li>
      </ul>
      <h3 id="sec-01-2-sources">1.2 上游文档关系</h3>
      <table>
        <thead><tr><th>文档</th><th>路径</th><th>本文档引用方式</th></tr></thead>
        <tbody>
          <tr><td>需求文档 V1.0-MVP</td><td><code>wiki/需求文档/JARVIS需求文档_V1.0_20260802.html</code></td><td>能力 ID、技术栈建议、Multica 参考、MVP 裁剪</td></tr>
          <tr><td>产品文档 V1.0-MVP</td><td><code>wiki/产品文档/JARVIS产品文档_V1.0_20260802.html</code></td><td>用户旅程、交互规范、信息架构、验收标准</td></tr>
          <tr><td>产品原型 V1.0</td><td><code>wiki/产品原型/V1.0/index.html</code></td><td>50 界面 → 路由/组件映射（§18）</td></tr>
        </tbody>
      </table>
      <h3 id="sec-01-3-decisions">1.3 已确认技术决策（约束条件）</h3>
      <table>
        <thead><tr><th>决策</th><th>技术影响</th></tr></thead>
        <tbody>
          <tr><td>Q1 Squad 对齐 Multica</td><td><code>internal/squad/</code> 数据结构、Leader 路由、消息总线 L12–L15 与 Multica SOP 一致</td></tr>
          <tr><td>Q2 仅 Multica Runtime</td><td>实现 <code>jarvis-agent</code> CLI + Daemon；不实现 H2 Client OAuth/Issue API</td></tr>
          <tr><td>Q3 轻量编程 UI</td><td>Diff 查看器 + 文件树；不引入 Monaco 完整 IDE；E5 Inline 补全排除</td></tr>
          <tr><td>Q4 全自定义模型</td><td>Provider 抽象 OpenAI/Anthropic 双协议；禁止硬编码 model id</td></tr>
          <tr><td>Q5 全局能力 V2.0</td><td>A3/I1–I4 等系统 Hook 不在 V1 进程模型中预留</td></tr>
        </tbody>
      </table>
      <details class="ai-block"><summary>AI 快速摘要 JSON</summary><pre>{
  "doc_type": "technical-design",
  "version": "1.0-mvp",
  "stack": {"daemon": "Go 1.22+", "ui": "TS+React19+Electron", "db": "SQLite", "build": "pnpm+turborepo"},
  "processes": ["electron-main", "electron-renderer", "jarvis-daemon", "jarvis-agent-cli", "mcp-child-processes"],
  "protocols": ["IPC(JSON-RPC)", "ACP(Multica)", "MCP(stdio/SSE/HTTP)", "OpenAI/Anthropic-API"],
  "mvp_milestones": ["M0","M1","M2","M3-core"]
}</pre></details>
""")

# §2 Architecture
sec("sec-02-architecture", "architecture", "2. 系统架构总览", """
      <h3 id="sec-02-1-layers">2.1 分层架构</h3>
      <div class="diagram">┌─────────────────────────────────────────────────────────────────────┐
│  Presentation Layer (Electron Renderer)                                │
│  packages/views · packages/ui · react-i18next · Zustand · TanStack Q  │
├─────────────────────────────────────────────────────────────────────┤
│  Application Layer (packages/core — TypeScript)                        │
│  AgentEngine · ModelRouter · ToolRegistry · MCPClient · SkillsLoader │
│  ChatService · TaskOrchestrator · SquadRouter · ContextManager       │
├─────────────────────────────────────────────────────────────────────┤
│  Platform Bridge (Electron Main + IPC)                                 │
│  WindowManager · TrayManager · SecureStorage · DaemonSupervisor        │
│  FileSystemBridge · NotificationBridge · WebViewHost(I8)             │
├─────────────────────────────────────────────────────────────────────┤
│  Runtime Layer (Go — daemon/)                                          │
│  jarvis-daemon · jarvis-agent CLI · TaskScheduler · WorkspacePool    │
│  MulticaAdapter(ACP) · ConcurrencyLimiter · HeartbeatReporter        │
├─────────────────────────────────────────────────────────────────────┤
│  Data Layer                                                            │
│  SQLite (WAL) · OS Keychain/DPAPI · ~/.jarvis/ 工作区文件               │
└─────────────────────────────────────────────────────────────────────┘</div>
      <h3 id="sec-02-2-processes">2.2 进程模型</h3>
      <table>
        <thead><tr><th>进程</th><th>语言</th><th>职责</th><th>生命周期</th></tr></thead>
        <tbody>
          <tr><td><code>electron-main</code></td><td>Node/Electron</td><td>窗口、托盘、IPC 路由、Daemon 启停、Keychain 代理</td><td>随 App 启动/退出</td></tr>
          <tr><td><code>electron-renderer</code></td><td>Chromium/React</td><td>全部 UI、调用 core 经 IPC 或 in-process bundle</td><td>每 BrowserWindow 一实例</td></tr>
          <tr><td><code>jarvis-daemon</code></td><td>Go</td><td>本地 Task 队列、Multica 心跳(15s)/轮询(3s)、并发控制</td><td>App 启动时由 main 拉起；可独立运行</td></tr>
          <tr><td><code>jarvis-agent</code></td><td>Go CLI</td><td>单次 Task 执行入口；Multica Daemon 通过 PATH 调用</td><td>Per-Task 子进程</td></tr>
          <tr><td><code>mcp-server-*</code></td><td>各语言</td><td>MCP stdio 子进程；按 Agent 配置按需 spawn</td><td>Per-session 或池化复用</td></tr>
          <tr><td><code>shell-worker</code></td><td>OS shell</td><td>E3 命令执行；沙箱 wrapper 限制 cwd/环境</td><td>Per-command 短生命周期</td></tr>
        </tbody>
      </table>
      <h3 id="sec-02-3-deployment">2.3 部署拓扑</h3>
      <div class="diagram">用户电脑 (macOS / Windows)
├── JARVIS.app / JARVIS.exe
│   ├── resources/daemon/jarvis-daemon      # Go 二进制内嵌或 sidecar
│   ├── resources/daemon/jarvis-agent
│   └── renderer bundle (packages/*)
├── ~/.jarvis/
│   ├── jarvis.db                           # SQLite 主库
│   ├── backups/                            # L18 自动备份
│   ├── logs/                               # C11 日志
│   └── workspaces/{id}/                    # Task 隔离目录(H1.12)
└── {project}/.jarvis/
    ├── JARVIS.md / AGENTS.md               # L10 上下文
    ├── agents/{name}.md                    # L11
    ├── skills/                             # G1 SKILL.md
    └── jarvisignore                        # L28</div>
      <h3 id="sec-02-4-modes">2.4 运行模式技术差异</h3>
      <table>
        <thead><tr><th>维度</th><th>本地模式</th><th>Multica Runtime 模式</th></tr></thead>
        <tbody>
          <tr><td>Task 来源</td><td><code>tasks</code> 表 INSERT by UI/core</td><td>外部 Multica Daemon → ACP → jarvis-agent</td></tr>
          <tr><td>配置来源</td><td>SQLite + .jarvis/</td><td>+ Multica 注入 mcp_config/skills/env (H1.6–H1.8)</td></tr>
          <tr><td>进度回传</td><td>IPC Event → Renderer 流式 UI</td><td>+ Daemon WS/HTTP 流式至 Multica Server (H1.4)</td></tr>
          <tr><td>离线</td><td>完全可用 (A8)</td><td>L37 离线缓冲队列，最多 2h</td></tr>
        </tbody>
      </table>
""")

# Continue with more sections - I'll add them in the Python file
# Due to length, I'll append sections programmatically

def table(headers, rows):
    h = "<thead><tr>" + "".join(f"<th>{x}</th>" for x in headers) + "</tr></thead>"
    b = "<tbody>" + "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows) + "</tbody>"
    return f"<table>{h}{b}</table>"

# §3 Monorepo
sec("sec-03-monorepo", "engineering", "3. Monorepo 工程结构", """
      <h3 id="sec-03-1-tree">3.1 目录树</h3>
      <pre><code>Jarvis/
├── apps/desktop/                 # Electron 入口 (electron-vite)
│   ├── src/main/                 # Main process: ipc/, tray/, daemon/
│   ├── src/preload/              # contextBridge API 暴露
│   └── src/renderer/             # React 入口，引用 packages/views
├── packages/
│   ├── core/                     # 无 UI 业务逻辑
│   │   ├── agent/                # AgentEngine, loop, tool-call
│   │   ├── model/                # ModelRouter, providers/
│   │   ├── mcp/                  # MCPClient, registry
│   │   ├── skills/               # SkillsLoader, SKILL.md parser
│   │   ├── task/                 # TaskOrchestrator, state machine
│   │   ├── squad/                # SquadRouter, message-bus
│   │   ├── coding/               # diff, index, lsp-bridge, git
│   │   ├── chat/                 # session, context, streaming
│   │   └── security/             # sandbox, approval, audit
│   ├── protocol/                 # TS 类型: IPC, Multica ACP, events
│   ├── ui/                       # shadcn 原子组件
│   ├── views/                    # 业务页面 (对应原型)
│   └── i18n/locales/{zh-CN,en}/
├── daemon/
│   ├── cmd/jarvis-agent/         # CLI 入口 (H1.1)
│   ├── cmd/jarvis-daemon/        # 守护进程
│   └── internal/
│       ├── runtime/              # Task 调度、workspace 池
│       ├── multica/              # ACP 协议适配
│       └── provider/             # Go 侧 model 调用(可选)
├── data/
│   ├── schema.sql
│   └── migrations/               # L19 版本迁移
└── wiki/                         # 文档</code></pre>
      <h3 id="sec-03-2-toolchain">3.2 工具链</h3>
""" + table(["工具", "版本/选型", "用途"], [
    ["Go", "1.22+", "daemon、jarvis-agent"],
    ["Node", "20 LTS", "Electron、pnpm"],
    ["pnpm", "9+", "workspaces"],
    ["Turborepo", "latest", "构建编排"],
    ["electron-vite", "latest", "Main/Renderer 打包"],
    ["TypeScript", "5.x", "core/ui/views"],
    ["React", "19", "UI"],
    ["sqlc / better-sqlite3", "—", "Go/TS SQLite 访问"],
    ["vitest + playwright", "—", "单元/E2E 测试"],
]) + """
      <h3 id="sec-03-3-packages">3.3 包依赖关系</h3>
      <div class="diagram">apps/desktop → packages/views → packages/ui
apps/desktop → packages/core → packages/protocol
packages/core ↛ packages/views  (禁止 UI 依赖反向渗透)
daemon/ 独立 Go module；通过 gRPC/HTTP/stdio JSON 与 TS core 通信
Electron main 作为 IPC 枢纽，不直接包含业务逻辑</div>
""")

# §4 Electron
sec("sec-04-electron", "desktop", "4. Electron 桌面壳层", """
      <h3 id="sec-04-1-main">4.1 Main Process 模块</h3>
""" + table(["模块", "路径", "能力 ID", "说明"], [
    ["WindowManager", "main/window/", "A1,A4,K1", "主窗口、吸附模式(400px)、最小宽800px"],
    ["TrayManager", "main/tray/", "A2,L7", "托盘菜单、Daemon 状态、快速打开"],
    ["DaemonSupervisor", "main/daemon/", "L7-L9,H1.10", "spawn jarvis-daemon、健康检查、重启"],
    ["SecureStorage", "main/secrets/", "J1,B7", "Keychain(macOS)/DPAPI(Win) 代理"],
    ["IpcRouter", "main/ipc/", "—", "JSON-RPC 2.0 over ipcMain.handle"],
    ["WebViewHost", "main/webview/", "I8,D8", "内置浏览器 session 隔离"],
    ["NotificationBridge", "main/notify/", "I5", "Task 完成系统通知"],
]) + """
      <h3 id="sec-04-2-preload">4.2 Preload API 契约</h3>
      <pre><code>// apps/desktop/src/preload/index.ts — contextBridge 暴露
interface JarvisAPI {
  invoke&lt;T&gt;(channel: string, payload?: unknown): Promise&lt;T&gt;;
  on(event: TaskEvent | ChatEvent, cb: (data: unknown) =&gt; void): () =&gt; void;
  platform: 'darwin' | 'win32';
  versions: { app: string; daemon: string; agent: string };
}
// 禁止 nodeIntegration；sandbox: true；contextIsolation: true</code></pre>
      <h3 id="sec-04-3-window">4.3 窗口与吸附 (A4)</h3>
      <ul>
        <li>默认尺寸 1200×800；吸附模式宽度 ~400px，贴屏幕右/左边缘</li>
        <li>实现：<code>screen.getDisplayMatching</code> + 自定义 <code>setBounds</code> 动画</li>
        <li>状态持久化：<code>settings.window_mode</code> 写入 SQLite</li>
      </ul>
      <h3 id="sec-04-4-theme">4.4 主题 (A10)</h3>
      <ul>
        <li>CSS 变量 + <code>data-theme</code>；与 Tailwind dark: 联动</li>
        <li>可选跟随系统：<code>nativeTheme.shouldUseDarkColors</code></li>
        <li>原型参考：27-深色主题 / 50-浅色主题</li>
      </ul>
""")

# §5 Frontend
sec("sec-05-frontend", "frontend", "5. 前端架构", """
      <h3 id="sec-05-1-stack">5.1 技术选型</h3>
""" + table(["层", "选型", "说明"], [
    ["UI 框架", "React 19", "并发特性用于流式消息"],
    ["路由", "React Router 7 / TanStack Router", "Settings 嵌套路由"],
    ["状态", "Zustand", "UI 局部状态；Agent/Task 选中态"],
    ["服务端状态", "TanStack Query", "Provider/Agent 列表缓存与乐观更新"],
    ["样式", "Tailwind CSS v4 + shadcn/ui", "packages/ui"],
    ["i18n", "react-i18next", "A11 zh-CN/en"],
    ["Markdown", "react-markdown + shiki", "D13 代码高亮"],
    ["Diff", "react-diff-viewer-continued 或自研", "E9 轻量 Diff，非 Monaco"],
]) + """
      <h3 id="sec-05-2-routing">5.2 路由结构</h3>
      <pre><code>/                     → ChatView (K1) 默认
/agents               → AgentListView (C2/F1)
/agents/:id           → AgentDetailView (F1-F6)
/tasks                → TaskBoardView (K4)
/tasks/:id            → TaskLogView (K5/L5)
/code                 → CodePanelView (K3/E11) — 分屏 K7
/settings/*           → SettingsLayout (C1-C12)
  /settings/providers
  /settings/mcp
  /settings/skills
  /settings/permissions (C6/J3)
  /settings/shortcuts (C5)
/onboarding           → OnboardingWizard (L1-L3)
/squad                → SquadView (F8/F9)
/canvas/:taskId       → CanvasView (K6)
/search               → GlobalSearchView (L21)</code></pre>
      <h3 id="sec-05-3-streaming">5.3 流式 UI (L5/D1)</h3>
      <ul>
        <li>IPC Event <code>chat:delta</code> / <code>task:log</code> 双通道</li>
        <li>聊天区：token 增量 append；工具调用卡片独立渲染</li>
        <li>日志面板：结构化 JSON log line + 原始 stdout 切换</li>
        <li>自动滚动可暂停；Esc 取消进行中的 Task (L4)</li>
      </ul>
""")

# §6 Agent Engine
sec("sec-06-agent", "agent-engine", "6. Agent 核心引擎", """
      <h3 id="sec-06-1-loop">6.1 Agent 执行循环</h3>
      <div class="diagram">Task Start
  │
  ├─ Load AgentConfig (F1-F6): prompt, model, tools, skills, sandbox
  ├─ Build Context (L16): history + JARVIS.md + @refs + skill injections
  │
  ▼
┌──────────────────────────────────────┐
│  REACT Loop (max_steps configurable)  │
│  1. ModelRouter.chat(stream=true)     │
│  2. Parse tool_calls / text           │
│  3. ApprovalGate (J2/F15) if needed     │
│  4. ToolRegistry.execute()            │
│  5. Append results → context          │
│  6. Until finish or max_steps         │
└──────────────────────────────────────┘
  │
  ▼
Task End → persist messages, audit log (J5), emit task:complete</div>
      <h3 id="sec-06-2-tools">6.2 内置 Tool Registry</h3>
""" + table(["Tool", "能力", "沙箱", "交付"], [
    ["read_file / write_file / list_dir", "E2", "workspace root + jarvisignore", "MVP"],
    ["run_shell", "E3", "cwd 限制、命令白名单 C6", "MVP"],
    ["git_*", "E4", "repo 须在 workspace 内", "V1.0"],
    ["search_code", "E1", "embedding index L27", "V1.0"],
    ["web_search", "D3/L25", "HTTP 代理 L33", "MVP"],
    ["mcp:*", "G5", "Per-tool J7 审批", "MVP/V1.0"],
    ["delegate_agent", "F7/F9", "Squad + L15 深度限制", "V1.0"],
    ["plan_only", "E10", "写工具 disabled", "V1.0"],
]) + """
      <h3 id="sec-06-3-context">6.3 上下文管理 (L16/L17)</h3>
      <ul>
        <li>Token 预估：tiktoken 或 provider 返回 usage；阈值触发自动摘要</li>
        <li>Pin 消息不参与摘要；摘要结果存 <code>session_summaries</code> 表</li>
        <li>Per-Agent <code>context_budget_tokens</code> 配置 (L17)</li>
      </ul>
      <h3 id="sec-06-4-memory">6.4 持久记忆 (F11)</h3>
      <ul>
        <li><code>agent_memories</code> 表：key-value + embedding optional</li>
        <li>注入点：System prompt 后缀或 retrieval 工具</li>
      </ul>
""")

# §7 Model Router
sec("sec-07-model", "model", "7. Model Router 与 Provider 抽象", """
      <h3 id="sec-07-1-interface">7.1 Provider 接口 (B13/Q4)</h3>
      <pre><code>interface ModelProvider {
  type: 'openai-compatible' | 'anthropic-compatible';
  baseUrl: string;
  apiKeyRef: string;  // Keychain key id，非明文
  models: CustomModel[];  // 用户注册，无预设
  chat(params: ChatParams): AsyncIterable&lt;ChatChunk&gt;;
  testConnection(modelId: string): Promise&lt;TestResult&gt;;  // B8
}

interface ChatParams {
  model: string;  // 用户自定义 id
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: 'low'|'medium'|'high';  // B5
}</code></pre>
      <h3 id="sec-07-2-router">7.2 ModelRouter 职责</h3>
      <ul>
        <li>Agent → Provider + modelId 解析 (B3)</li>
        <li>Fallback 链 (B10)：主模型失败 → 备用 model 自动切换</li>
        <li>超时/重试/熔断 (L34)：<code>ProviderPolicy { timeoutMs, maxRetries, circuitBreaker }</code></li>
        <li>Usage 记录 → <code>token_usage</code> 表 (B9)</li>
        <li>参数映射：OpenAI <code>max_tokens</code> ↔ Anthropic <code>max_tokens</code> / thinking blocks</li>
      </ul>
      <h3 id="sec-07-3-local">7.3 本地模型 (B11)</h3>
      <p>Ollama / LM Studio / vLLM 统一作为 <code>openai-compatible</code> Provider；Base URL 指向本地端口；model id 由用户填写。</p>
      <div class="callout callout-warn"><strong>禁止：</strong>代码或种子数据中硬编码 <code>gpt-4</code>、<code>claude-3</code> 等名称 (Q4)。</div>
""")

# §8 Task & Daemon
sec("sec-08-task", "task-daemon", "8. Task 调度与 Daemon", """
      <h3 id="sec-08-1-state">8.1 Task 状态机</h3>
      <div class="diagram">queued ──► running ──► completed
              │           │
              │           ├──► failed ──► (retry) ──► queued
              │           │
              └──► cancelled    paused ──► running</div>
      <p>对齐 H1.13 与 K4 看板列；状态变更写 <code>tasks</code> 表并广播 IPC event。</p>
      <h3 id="sec-08-2-daemon">8.2 jarvis-daemon (Go)</h3>
""" + table(["参数", "值", "来源"], [
    ["心跳间隔", "15s", "H1.10 / Multica"],
    ["Task 轮询", "3s", "Multica daemon"],
    ["默认并发/Agent", "6", "H1.11"],
    ["默认并发/机器", "20", "H1.11"],
    ["Workspace 隔离", "每 Task 独立目录", "H1.12"],
]) + """
      <h3 id="sec-08-3-cli">8.3 jarvis-agent CLI (H1.1, L35)</h3>
      <pre><code>jarvis-agent run --task-id &lt;id&gt; --conversation &lt;uuid&gt;  # H1.5 会话恢复
jarvis-agent --version
jarvis-agent --health
jarvis-agent --list-models</code></pre>
      <p>安装时 symlink 至 PATH；L2 环境诊断检测 CLI 可探测性。</p>
      <h3 id="sec-08-4-queue">8.4 本地队列与并发 (F14)</h3>
      <ul>
        <li><code>TaskQueue</code>：优先级队列 + per-agent semaphore</li>
        <li>C10 用户可配全局并发上限</li>
        <li>E14 并行多 Task：独立 workspace + 独立 MCP session</li>
      </ul>
""")

# §9 MCP & Skills
sec("sec-09-mcp-skills", "ecosystem", "9. MCP 与 Skills 生态", """
      <h3 id="sec-09-1-mcp">9.1 MCP Client 架构 (G4-G8)</h3>
""" + table(["传输", "实现", "场景"], [
    ["stdio", "child_process.spawn", "本地 MCP server 主流"],
    ["SSE", "EventSource / fetch stream", "远程 MCP"],
    ["HTTP", "fetch JSON-RPC", "远程 MCP"],
]) + """
      <ul>
        <li>启动：Agent session 开始 → 读取 Agent 绑定的 MCP 列表 (G6 隔离)</li>
        <li>发现：<code>tools/list</code> → 注册至 ToolRegistry 前缀 <code>mcp:{server}:{tool}</code></li>
        <li>审批：首次调用触发 UI modal (G8/J7)；批准后写 <code>mcp_grants</code> 表</li>
        <li>内置：filesystem / git / browser MCP (G7) 预打包配置模板</li>
      </ul>
      <h3 id="sec-09-2-skills">9.2 Skills 加载 (G1-G3, H1.7)</h3>
      <ul>
        <li>扫描 <code>.jarvis/skills/*/SKILL.md</code> + 用户导入目录</li>
        <li>解析 frontmatter：name, description, triggers</li>
        <li>注入：合并至 system prompt 或作为 <code>skill_load</code> 工具按需加载</li>
        <li>Multica 注入冲突：L38 检测同名 skill → UI 二选一/合并策略</li>
      </ul>
      <h3 id="sec-09-3-plugin">9.3 Plugin 扩展 (G9)</h3>
      <p>TypeScript 插件 API：<code>registerTool(def, handler)</code>；插件目录 <code>~/.jarvis/plugins/</code>；沙箱 vm 或独立 worker 执行。</p>
""")

# §10 Squad
sec("sec-10-squad", "multi-agent", "10. 多 Agent 协作 (Squad)", """
      <h3 id="sec-10-1-model">10.1 数据模型 (Q1:A)</h3>
      <pre><code>Squad {
  id, name, leaderAgentId, memberAgentIds[],
  instructions: string,  // Squad Operating Protocol
  status: 'idle' | 'in_progress' | 'in_review'
}
AgentMessage {  // L12 消息总线
  id, fromAgentId, toAgentId, type: 'request'|'response'|'delegate'|'complete',
  payload, parentTaskId, timestamp
}</code></pre>
      <h3 id="sec-10-2-routing">10.2 Leader 路由 (F8/F9)</h3>
      <ol>
        <li>用户向 Leader 发送 Task → Squad.status = in_progress</li>
        <li>Leader LLM 决策 → <code>delegate_agent(@成员, subtask)</code></li>
        <li>成员 Agent 独立 REACT loop；结果回传 Leader</li>
        <li>Leader 汇总 → Squad.status = in_review → F15 用户审批</li>
      </ol>
      <h3 id="sec-10-3-safety">10.3 安全约束 (L14/L15)</h3>
      <ul>
        <li>调用链图：DAG 存 <code>agent_call_edges</code>；UI 可视化 (L14)</li>
        <li>最大委派深度默认 5；循环检测：同 (from,to,taskHash) 重复 → 终止</li>
        <li>上下文传递策略 (L13)：full | summary | conclusion-only | custom template</li>
      </ul>
""")

# §11 Coding
sec("sec-11-coding", "coding", "11. 编程 Agent 子系统", """
      <h3 id="sec-11-1-panel">11.1 轻量代码面板 (Q3:B, E11/K3)</h3>
      <ul>
        <li>文件树：<code>react-arborist</code> 或自研；过滤 jarvisignore</li>
        <li>预览：只读语法高亮 (shiki)；不提供编辑保存</li>
        <li>Diff：unified diff 视图；逐 hunk Accept/Reject (E9)</li>
        <li>分屏 K7：聊天 + 文件/Diff 并排 ResizablePanel</li>
      </ul>
      <h3 id="sec-11-2-at">11.2 @ 引用 (E6)</h3>
      <p>输入框 <code>@</code> 触发 fuzzy picker：file / folder / symbol(LSP) / doc。解析为 context attachment 结构注入 messages。</p>
      <h3 id="sec-11-3-index">11.3 代码索引 (E1, L27-L28)</h3>
""" + table(["组件", "技术", "说明"], [
    ["Chunker", "tree-sitter / 行块", "按函数/类切分"],
    ["Embedding", "用户 Provider embedding API", "向量存 sqlite-vec 或 LanceDB 本地"],
    ["Incremental", "fs.watch + debounce", "变更文件重索引"],
    [".jarvisignore", "gitignore 语法", "排除 node_modules 等"],
]) + """
      <h3 id="sec-11-4-lsp">11.4 LSP 集成 (E7) — Agent 侧</h3>
      <p>Headless LSP client (stdio)；Agent 改码后 pull diagnostics；服务于 E8 测试修复循环。非用户 IDE 体验。</p>
      <h3 id="sec-11-5-rollback">11.5 Task 级回滚 (L26)</h3>
      <p>Task 开始前 snapshot workspace git stash 或 file copy；一键 restore。</p>
""")

# §12 Chat & Office
sec("sec-12-office", "office", "12. 对话与办公子系统", """
      <h3 id="sec-12-1-chat">12.1 对话服务 (D1-D3, D13-D15)</h3>
      <ul>
        <li>Session 存 <code>chat_sessions</code> + <code>chat_messages</code></li>
        <li>联网搜索 D3/L25：可配置搜索引擎 API；结果 cite 注入 context</li>
        <li>导出 D14：Markdown 原生；PDF 经 print-to-pdf 或 puppeteer core</li>
        <li>Prompt 模板库 D15：<code>prompt_templates</code> 表 + 变量 substitution</li>
      </ul>
      <h3 id="sec-12-2-office">12.2 办公增强 (D4-D12) — V1.0</h3>
""" + table(["功能", "技术方案", "原型"], [
    ["D4 划词", "Renderer Selection API + ContextMenu", "25-划词菜单"],
    ["D5 写作", "专用 system prompt + 模板", "14-AI写作助手"],
    ["D7 PDF", "pdf.js 渲染 + 分页摘要", "15-PDF伴读"],
    ["D8 网页", "WebViewHost + readability 提取", "16-内置浏览器"],
    ["D9 视频", "链接 metadata + transcript API/Whisper", "31-视频内容摘要"],
    ["D10 文生图", "Provider image API 抽象", "32-文生图"],
    ["D11 语音", "Web Speech API / Whisper local", "26-语音输入"],
    ["D12 文件", "office parser (mammoth/xlsx)", "33-文件上传分析"],
    ["L23 识图", "multimodal message content", "49-多模态图片理解"],
]) + """
""")

# §13 Database
sec("sec-13-database", "data", "13. 数据层设计 (SQLite)", """
      <h3 id="sec-13-1-schema">13.1 核心表结构</h3>
      <pre><code>-- providers & models (B1-B13)
CREATE TABLE providers (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT, base_url TEXT,
  api_key_ref TEXT, policy_json TEXT, created_at INTEGER
);
CREATE TABLE models (
  id TEXT PRIMARY KEY, provider_id TEXT, model_id TEXT UNIQUE,
  display_name TEXT, capabilities_json TEXT
);

-- agents (F1-F6)
CREATE TABLE agents (
  id TEXT PRIMARY KEY, name TEXT, avatar_url TEXT, system_prompt TEXT,
  model_id TEXT, workspace_id TEXT, tool_policy_json TEXT,
  context_budget INTEGER, archived INTEGER DEFAULT 0
);

-- tasks (L4-L6, H1.13)
CREATE TABLE tasks (
  id TEXT PRIMARY KEY, agent_id TEXT, squad_id TEXT,
  status TEXT, source TEXT,  -- 'local' | 'multica'
  multica_task_id TEXT, workspace_path TEXT,
  error_code TEXT, started_at INTEGER, finished_at INTEGER
);

-- chat
CREATE TABLE chat_sessions (id TEXT PRIMARY KEY, agent_id TEXT, title TEXT, ...);
CREATE TABLE chat_messages (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content_json TEXT, ...);

-- mcp & skills
CREATE TABLE mcp_servers (...);
CREATE TABLE skills (...);
CREATE TABLE mcp_grants (server_id, tool_name, approved_at);

-- audit & usage (J5, B9)
CREATE TABLE audit_logs (...);
CREATE TABLE token_usage (...);

-- squads (F8)
CREATE TABLE squads (...);
CREATE TABLE agent_messages (...);  -- L12</code></pre>
      <h3 id="sec-13-2-migration">13.2 迁移与备份 (L18-L20)</h3>
      <ul>
        <li><code>schema_migrations</code> 表；启动时 golang-migrate / TS migrator</li>
        <li>退出时 + 定时 WAL checkpoint → <code>~/.jarvis/backups/{timestamp}.db</code></li>
        <li>敏感擦除：DELETE + Keychain 项删除 + VACUUM</li>
      </ul>
      <h3 id="sec-13-3-access">13.3 访问模式</h3>
      <ul>
        <li>Go daemon：sqlc 生成类型安全查询</li>
        <li>TS core：better-sqlite3 只读副本或 IPC 委托 main 写</li>
        <li>WAL 模式；写序列化通过 main process 单写者避免锁争用</li>
      </ul>
""")

# §14 IPC
sec("sec-14-ipc", "protocol", "14. IPC 与事件协议", """
      <h3 id="sec-14-1-rpc">14.1 IPC Methods (JSON-RPC style)</h3>
""" + table(["Method", "方向", "说明"], [
    ["provider.list/create/update/delete", "R→M", "B 模块 CRUD"],
    ["provider.test", "R→M", "B8 连通测试"],
    ["agent.*", "R→M", "Agent CRUD"],
    ["task.create/cancel/pause/retry", "R→M", "L4"],
    ["chat.send", "R→M", "发起对话→创建 Task"],
    ["settings.get/set", "R→M", "C 模块"],
    ["daemon.status/restart", "R→M", "L7"],
    ["secrets.set/get", "R→M", "J1 仅 main 可访问 Keychain"],
    ["dialog.openFile", "R→M", "文件选择"],
]) + """
      <h3 id="sec-14-2-events">14.2 服务端推送 Events</h3>
      <pre><code>chat:delta      { sessionId, messageId, delta }
chat:tool_call  { sessionId, toolCall }
task:status     { taskId, status, progress? }
task:log        { taskId, line, stream: 'stdout'|'stderr'|'agent' }
daemon:heartbeat { connected, pendingTasks }
approval:request { id, type, payload }  // J2/F15</code></pre>
""")

# §15 Multica
sec("sec-15-multica", "multica", "15. Multica Runtime 集成", """
      <h3 id="sec-15-1-acp">15.1 ACP 协议对齐 (H3 — 首选)</h3>
      <p>参考 Multica providers 文档；MCP 注入字段 <code>mcpServers</code> JSON。实现包 <code>daemon/internal/multica/acp/</code>。</p>
      <h3 id="sec-15-2-flow">15.2 Runtime 执行流</h3>
      <div class="diagram">Multica Server → Multica Daemon → spawn jarvis-agent
  → parse task payload (issue, comments, instruction)
  → merge MCP config (H1.6) + skills (H1.7) + env (H1.8)
  → execute REACT loop → stream progress (H1.4)
  → return result + model list (H1.9)
  → L36 local task_id ↔ multica_task_id 映射</div>
      <h3 id="sec-15-3-offline">15.3 离线缓冲 (L37)</h3>
      <p>Multica Server 不可达时 Task 存 <code>multica_pending_queue</code>；恢复后按 FIFO 上传；超时 2h 标记 failed。</p>
      <h3 id="sec-15-4-ui">15.4 Runtime UI (L39, 原型 13/42/48)</h3>
      <p>设置页/托盘展示：注册状态、协议族、CLI 版本、心跳时间、当前 Multica Task 列表。</p>
      <div class="callout"><strong>排除 H2：</strong>不实现 OAuth、Issue API、Autopilot Client。</div>
""")

# §16 Security
sec("sec-16-security", "security", "16. 安全与沙箱", """
      <h3 id="sec-16-1-secrets">16.1 密钥管理 (J1, B7)</h3>
      <ul>
        <li>API Key 仅存 Keychain/DPAPI；DB 存 <code>api_key_ref</code> 引用</li>
        <li>日志脱敏：regex 过滤 sk- / Bearer 模式</li>
      </ul>
      <h3 id="sec-16-2-sandbox">16.2 工具沙箱 (J3, J6, E13)</h3>
""" + table(["级别", "文件", "网络", "Shell"], [
    ["readonly", "读 workspace", "禁止", "禁止"],
    ["readwrite", "读写 workspace", "白名单域名", "白名单命令"],
    ["system", "需 F15 审批", "需审批", "需审批"],
]) + """
      <h3 id="sec-16-3-approval">16.3 审批流 (J2, F15, J7)</h3>
      <p>敏感操作清单 configurable：<code>rm -rf</code>、写 workspace 外路径、MCP 首次调用、网络请求。UI modal 阻塞至用户确认/拒绝；拒绝返回 tool error 给 Agent。</p>
      <h3 id="sec-16-4-audit">16.4 审计 (J5)</h3>
      <p>全量 tool call + approval 结果写 <code>audit_logs</code>；C11 日志面板可筛选导出。</p>
""")

# §17 i18n
sec("sec-17-i18n", "i18n", "17. 国际化与主题", """
      <h3 id="sec-17-1-i18n">17.1 i18n 实现 (A11)</h3>
      <ul>
        <li>资源：<code>packages/i18n/locales/zh-CN/*.json</code>、<code>en/*.json</code></li>
        <li>键名规范：<code>settings.provider.title</code>；ESLint 规则禁止 JSX 硬编码中文</li>
        <li>覆盖：UI、错误码、托盘、通知、向导；不覆盖 Agent prompt/Skills</li>
        <li>CI：<code>i18n:check</code> 脚本校验 key 对称</li>
      </ul>
      <h3 id="sec-17-2-theme">17.2 主题令牌</h3>
      <p>与文档/原型一致：CSS variables 映射 Tailwind；组件库 shadcn 原生支持 dark mode。</p>
""")

# §18 Prototype mapping
sec("sec-18-prototype", "prototype-map", "18. 产品原型 → 技术映射", """
      <p>产品原型 V1.0 共 50 界面，以下映射到 <code>packages/views</code> 组件与路由。</p>
""" + table(["原型 ID", "View 组件", "核心依赖", "Tier"], [
    ["01 主聊天", "ChatView", "core/chat, K1", "MVP"],
    ["02-04 首次引导", "OnboardingWizard", "L1-L3, B, F", "MVP"],
    ["05 Agent列表", "AgentListView", "C2", "MVP"],
    ["06 Provider", "ProviderSettingsView", "B1-B13", "MVP"],
    ["07 Diff面板", "CodePanelView", "E9,K3", "V1.0"],
    ["08 Task看板", "TaskBoardView", "K4,L4", "V1.0"],
    ["09 Squad", "SquadView", "F8,F9,L12", "V1.0"],
    ["10 设置页", "SettingsLayout", "C1-C12", "MVP/V1.0"],
    ["11 Skills", "SkillsSettingsView", "G1-G3", "MVP/V1.0"],
    ["12 MCP", "McpSettingsView", "G4-G8", "MVP/V1.0"],
    ["13 Multica状态", "RuntimeStatusView", "H1,L35,L39", "V1.0"],
    ["14-16 办公", "WritingView, PdfReader, BrowserView", "D5,D7,D8,I8", "V1.0"],
    ["17 窗口吸附", "WindowManager", "A4", "MVP"],
    ["18 托盘", "TrayManager", "A2,L7", "MVP"],
    ["19 敏感确认", "ApprovalModal", "J2,F15", "MVP"],
    ["20 Canvas", "CanvasView", "K6", "V1.0"],
    ["21 全局搜索", "GlobalSearchView", "L21", "V1.0"],
    ["22-23 分屏/Plan", "SplitLayout, PlanModeBadge", "K7,E10", "V1.0"],
    ["24-25 Task日志/划词", "TaskLogView, SelectionMenu", "L5,D4", "V1.0"],
    ["26-35 办公增强", "各 Feature 组件", "D6-D15", "MVP/V1.0"],
    ["36 Token统计", "UsageDashboard", "B9", "V1.0"],
    ["37-45 设置扩展", "Settings 子页", "C5,C6,C12,L18", "V1.0"],
    ["46 Task取消", "TaskControlBar", "L4", "MVP"],
    ["47 @引用", "MentionPicker", "E6", "V1.0"],
    ["48 运行模式", "ModeIndicator", "L39,A8", "V1.0"],
    ["49 多模态", "ImageAttachment", "L23", "V1.0"],
    ["50 浅色主题", "ThemeProvider", "A10", "MVP"],
]) + """
""")

# §19 Capability mapping
sec("sec-19-cap-map", "capability-map", "19. 能力 ID → 技术组件映射", """
      <p>全量 A–L 能力 ID 与技术实现对照（节选核心；完整索引见需求文档 §10.6）。</p>
""" + table(["模块", "能力 ID", "技术组件", "Milestone"], [
    ["A 平台", "A1-A2,A4,A6,A8,A10-A11", "Electron main, SQLite, i18n, ThemeProvider", "M0"],
    ["B 模型", "B1-B13", "ModelRouter, Provider adapters, Keychain", "M1/M8"],
    ["C 配置", "C1-C12", "Settings views, IPC CRUD", "M0-M8"],
    ["D 办公", "D1-D15", "ChatService, Office feature modules", "M1/M5"],
    ["E 编程", "E1-E15(除E5)", "Coding subsystem, Diff, LSP bridge", "M3/M4"],
    ["F Agent", "F1-F15", "AgentEngine, SquadRouter, ApprovalGate", "M2/M6"],
    ["G 生态", "G1-G9", "MCPClient, SkillsLoader, PluginHost", "M3/M8"],
    ["H Multica", "H1,H3", "jarvis-agent, multica/acp", "M7"],
    ["I 集成", "I5,I8", "NotificationBridge, WebViewHost", "M5/M6"],
    ["J 安全", "J1-J7", "SecureStorage, Sandbox, Audit", "M3/M8"],
    ["K UI", "K1-K7(轻量K3)", "views/*", "M0-M8"],
    ["L 平台", "L1-L39(除L24)", "各子系统 cross-cutting", "M0-M8"],
]) + """
""")

# §20 Build & Test
sec("sec-20-devops", "devops", "20. 构建、测试与发布", """
      <h3 id="sec-20-1-build">20.1 构建流水线</h3>
      <pre><code>pnpm turbo build
├── packages/core, ui, views, i18n, protocol
├── apps/desktop (electron-vite → .dmg / .exe)
└── daemon/ (go build -o resources/daemon/...)

# CI: lint → test → build → playwright smoke</code></pre>
      <h3 id="sec-20-2-test">20.2 测试策略</h3>
""" + table(["层级", "工具", "覆盖"], [
    ["单元", "vitest", "core/agent, model, task 状态机"],
    ["组件", "RTL + vitest", "ui, views 关键交互"],
    ["集成", "vitest + temp SQLite", "Provider mock, MCP mock server"],
    ["E2E", "Playwright", "MVP 旅程 S1/S2"],
    ["Go", "go test", "daemon scheduler, multica adapter"],
]) + """
      <h3 id="sec-20-3-perf">20.3 性能指标</h3>
      <ul>
        <li>冷启动 &lt; 3s（MVP 目标）；Daemon 就绪 &lt; 1s</li>
        <li>流式首 token &lt; 2s（依赖 Provider）</li>
        <li>SQLite 单表 10 万 message 查询 &lt; 100ms（索引 session_id）</li>
      </ul>
""")

# §21 Milestones
sec("sec-21-milestones", "milestones", "21. 技术 Milestone 交付清单", """
""" + table(["Milestone", "技术交付物", "验收"], [
    ["M0 骨架", "Electron 壳、托盘、SQLite schema v1、i18n 框架、Settings 骨架、主题", "App 启动、语言切换、设置可打开"],
    ["M1 对话+模型", "ModelRouter、OpenAI/Anthropic adapter、Chat 流式、Provider CRUD、Key 加密", "B8 测试通过、多轮对话"],
    ["M2 Agent", "AgentEngine v1、Task 状态机、取消/重试、JARVIS.md 注入", "S2 场景文件读写 Shell"],
    ["M3 核心", "MCP stdio、Skills 加载、Shell/文件 tool、基础沙箱", "MVP 工具链闭环"],
    ["M3 剩余", "Git tool、MCP 管理 UI、Daemon UI、完整沙箱策略", "C3/C4 可用"],
    ["M4 编程", "Diff 面板、@引用、Plan mode、代码索引", "S4 场景"],
    ["M5 办公", "划词/PDF/WebView/语音/识图", "D4-D12"],
    ["M6 多Agent", "Squad、消息总线、审批、通知", "S5 场景"],
    ["M7 Runtime", "jarvis-agent CLI、ACP、Multica 联调", "S6 场景"],
    ["M8 完善", "看板、Canvas、备份迁移、Token 统计、配置导入导出", "V1.0 封版"],
]) + """
      <div class="callout"><strong>MVP 范围</strong> = M0 + M1 + M2 + M3<sub>核心</sub>；与需求文档 §10.1 一致。</div>
""")

# §22 Risks
sec("sec-22-risks", "risks", "22. 技术风险与对策", """
""" + table(["风险", "影响", "对策"], [
    ["V1 范围过大", "延期", "严格 MVP 裁剪；M3 后增量交付"],
    ["Multica 协议变更", "Runtime 不兼容", "protocol 包版本锁定；适配层隔离"],
    ["MCP 子进程泄漏", "内存/僵尸进程", "session 结束 kill tree；健康检查"],
    ["SQLite 写争用", "UI 卡顿", "单写者 main；WAL；读副本"],
    ["Electron 体积", "下载慢", "asar 压缩；可选 Tauri V2 迁移"],
    ["LSP 多语言复杂度", "维护成本", "仅 Agent 侧必需语言；懒加载"],
    ["全自定义模型 UX", "配置门槛高", "L1 向导 + L3 诊断 + 模板 Provider"],
]) + """
""")

# §23 Config & Env
sec("sec-23-config", "config", "23. 配置与环境管理", """
      <h3 id="sec-23-1-settings">23.1 设置存储 (C1-C12)</h3>
      <p>用户配置存 SQLite <code>settings</code> 表 (key-value JSON) + 关系表 (providers/agents)。Settings 变更经 IPC 写 main 单写者。</p>
      <h3 id="sec-23-2-env">23.2 环境变量注入 (C8)</h3>
      <p>Agent 级 <code>env_vars_json</code>；Task 启动时 merge：系统 env → workspace .env → agent env → Multica 注入 (H1.8)。敏感 key 走 Keychain 引用。</p>
      <h3 id="sec-23-3-cli-args">23.3 CLI 自定义参数 (C9)</h3>
      <p>jarvis-agent 支持用户配置额外 flags；存 <code>agents.cli_args_json</code>；Multica Task 可覆盖。</p>
      <h3 id="sec-23-4-import">23.4 配置导入导出 (C12)</h3>
      <pre><code># config-export.yaml 结构（API Key 导出为占位符）
version: 1
providers: [...]
agents: [...]
mcp_servers: [...]
skills: [...]
settings: { theme, locale, concurrency_limit }</code></pre>
      <p>导入时冲突策略：skip | overwrite | merge；Schema 版本校验 (L19)。</p>
      <h3 id="sec-23-5-proxy">23.5 网络代理 (L33)</h3>
      <p>全局 HTTP/SOCKS 配置；ModelRouter 与 MCP HTTP 客户端共用 <code>ProxyAgent</code>；Go daemon 读 <code>HTTP_PROXY</code>。</p>
      <h3 id="sec-23-6-workspace">23.6 工作区绑定 (C7, L10-L11)</h3>
      <ul>
        <li>每 Agent 可绑 <code>workspace_id</code> → 绝对路径</li>
        <li>首次绑定时生成 JARVIS.md / AGENTS.md 模板 (L10)</li>
        <li>Agent 专属 <code>.jarvis/agents/{slug}.md</code> 自动注入 system context (L11)</li>
      </ul>
""")

# §24 H1 detail
sec("sec-24-h1-detail", "multica-detail", "24. Multica H1 能力技术对照", """
""" + table(["ID", "技术要求", "实现位置"], [
    ["H1.1", "jarvis-agent CLI PATH 可探测", "daemon/cmd/jarvis-agent + installer symlink"],
    ["H1.2", "ACP 协议族兼容", "daemon/internal/multica/acp"],
    ["H1.3", "接收 Task 上下文 issue/评论/指令", "TaskPayload parser → AgentEngine initial messages"],
    ["H1.4", "流式回传进度/结果", "StreamWriter → WS/HTTP chunk"],
    ["H1.5", "会话恢复 --conversation", "chat_sessions 按 uuid 加载 history"],
    ["H1.6", "Multica 注入 MCP 配置", "merge mcpServers → runtime MCP spawn list"],
    ["H1.7", "Multica 注入 Skills", "copy to task workspace .jarvis/skills/"],
    ["H1.8", "环境变量/CLI 参数", "Task env merge + flag override"],
    ["H1.9", "返回可用模型列表", "--list-models 读 models 表"],
    ["H1.10", "内置 Daemon 15s 心跳 + 3s 轮询", "daemon/internal/runtime/heartbeat.go"],
    ["H1.11", "并发 6/Agent, 20/机器", "semaphore config + C10 override"],
    ["H1.12", "Task 独立 workspace", "WorkspacePool.Allocate()"],
    ["H1.13", "生命周期 queued→running→completed/failed", "Task FSM §8.1"],
    ["H1.14", "自定义 Runtime Profile", "runtime_profiles 表 + CLI profile flag"],
]) + """
""")

# §25 L module tech
sec("sec-25-l-module", "platform-l", "25. L 模块平台体验技术规格", """
""" + table(["ID", "技术实现"], [
    ["L1", "OnboardingWizard 3-step state machine；完成后写 settings.onboarding_done"],
    ["L2", "main/diagnostics: which node/go/git, daemon ping, PATH which jarvis-agent"],
    ["L3", "DiagnosticsService 并行 ping providers + MCP + local model；生成报告组件"],
    ["L4", "TaskOrchestrator.cancel/pause/retry；SIGTERM shell 子进程"],
    ["L5", "双通道 EventEmitter: chat:delta + task:log"],
    ["L6", "error_code enum + UI 一键 retry 同 payload"],
    ["L7", "TrayManager 菜单项 + ipc daemon.restart"],
    ["L8", "RuntimeStatusView 读 daemon /status JSON"],
    ["L9", "psutil 风格 CPU/mem + 活跃 task 列表"],
    ["L12", "agent_messages 表 + in-memory bus 路由"],
    ["L13", "ContextPassingStrategy enum + 模板 engine"],
    ["L14", "agent_call_edges → react-flow 可视化"],
    ["L15", "delegate depth counter + cycle detection hash set"],
    ["L16", "ContextManager.summarize() 调用 ModelRouter"],
    ["L17", "agents.context_budget INTEGER"],
    ["L18", "main 定时 + before-quit 复制 db 到 backups/"],
    ["L19", "migrations/*.sql 顺序应用"],
    ["L20", "WipeService: 删表+Keychain+workspace 可选"],
    ["L21", "FTS5 索引 chat_messages + agents + tasks"],
    ["L22", "HTML5 drag-drop → attachment 或 copy to workspace"],
    ["L23", "messages content[] type:image_url"],
    ["L25", "search_providers 配置 + web_search tool 路由"],
    ["L26", "TaskSnapshot git stash or copy-on-write"],
    ["L27", "IndexStore sqlite-vec / embedding table"],
    ["L28", "ignore crate / gitignore parser"],
    ["L29", "response_format json_schema on ModelRouter"],
    ["L30", "agent_templates 种子数据用户可选"],
    ["L31", "agent_config_versions 表 + diff UI"],
    ["L32", "Skills import: folder picker + URL fetch"],
    ["L33", "settings.proxy_json"],
    ["L34", "ProviderPolicy circuit breaker (opossum)"],
    ["L35", "cobra CLI --version --health --list-models"],
    ["L36", "tasks.multica_task_id UNIQUE INDEX"],
    ["L37", "multica_pending_queue 表 + retry worker"],
    ["L38", "SkillsMerger.conflict UI"],
    ["L39", "ModeIndicator: local | runtime_registered | runtime_busy"],
]) + """
""")

# §26 DAG & triggers
sec("sec-26-workflow", "workflow", "26. 工作流与触发器", """
      <h3 id="sec-26-1-dag">26.1 Agent 编排 DAG (F10)</h3>
      <p>工作流定义 JSON：<code>{ nodes: AgentNode[], edges: Edge[] }</code>。调度器按拓扑序执行；每节点输出写入下一节点 context。UI 可选可视化编辑器 (V1.0 M8)。</p>
      <h3 id="sec-26-2-triggers">26.2 触发方式 (F12)</h3>
""" + table(["类型", "实现"], [
    ["manual", "UI chat / task.create"],
    ["cron", "node-cron in main；触发 task.create"],
    ["event", "filesystem watch / git hook webhook local"],
]) + """
      <h3 id="sec-26-3-plan">26.3 Plan 模式 (E10)</h3>
      <p>Agent profile flag <code>plan_only: true</code> → ToolRegistry 过滤 write/shell tools；仅 read + analysis tools 可用。</p>
      <h3 id="sec-26-4-structured">26.4 结构化输出 (L29)</h3>
      <p>OpenAI <code>response_format: json_schema</code> / Anthropic tool-based structured output；结果校验 ajv。</p>
""")

# §27 External IDE
sec("sec-27-ide", "external-ide", "27. 外部 IDE 对接 (E12)", """
      <ul>
        <li>协议层：HTTP localhost server 暴露 <code>/open?file=</code>、<code>/diff?task=</code></li>
        <li>CLI：<code>jarvis open --file path:line</code> 调用 VS Code <code>code -g</code></li>
        <li>VS Code 插件：V1.0 可后置；MVP 不依赖</li>
      </ul>
""")

# §28 Canvas
sec("sec-28-canvas", "canvas", "28. Canvas 可视化 (K6)", """
      <p>Task 产出结构化 artifact（表格/图表/Mermaid）时渲染专用视图。技术栈：React + 可选 recharts；Mermaid.js 渲染 diagram。数据存 <code>task_artifacts</code> 表 JSON blob。</p>
""")

# §29 Notification
sec("sec-29-notify", "notification", "29. 通知系统 (I5)", """
      <ul>
        <li>App 内：Toast + Task 列表 badge</li>
        <li>系统级：Electron Notification API；仅 task:complete / task:failed</li>
        <li>不做通用通知中心；不实现 I6-I7 IM/日历</li>
      </ul>
""")

# §30 Startup
sec("sec-30-startup", "startup", "30. 应用启动与生命周期", """
      <h3 id="sec-30-1-boot">30.1 冷启动序列</h3>
      <div class="diagram">electron-main 启动
  ├─ 1. 加载 env / 解析 ~/.jarvis 路径
  ├─ 2. SQLite 打开 + 运行 pending migrations (L19)
  ├─ 3. SecureStorage 初始化 Keychain 连接
  ├─ 4. DaemonSupervisor.spawn(jarvis-daemon)
  │     └─ daemon: 加载 config → 启动 heartbeat goroutine
  ├─ 5. TrayManager.create()
  ├─ 6. WindowManager.createMainWindow()
  ├─ 7. Renderer 加载 → i18n init → 检查 onboarding_done
  │     ├─ false → /onboarding (L1)
  │     └─ true  → / (K1 主聊天)
  └─ 8. 后台: DiagnosticsService optional cache (L2)</div>
      <h3 id="sec-30-2-shutdown">30.2 优雅退出</h3>
      <ol>
        <li>取消进行中的 Task（询问用户或 auto-cancel 配置）</li>
        <li>SQLite WAL checkpoint + L18 备份</li>
        <li>Daemon SIGTERM → 等待 active tasks drain（超时 30s）</li>
        <li>MCP 子进程 kill tree</li>
      </ol>
      <h3 id="sec-30-3-offline">30.3 离线模式 (A8)</h3>
      <p>检测：无网络时 ModelRouter 仅路由至 type=local provider；web_search tool 禁用；UI 显示 offline badge。本地 Ollama 可用则对话/Agent 正常。</p>
""")

# §31 B module
sec("sec-31-b-module", "b-module", "31. B 模块模型管理技术规格", """
""" + table(["ID", "技术实现"], [
    ["B1", "providers.type enum: openai-compatible | anthropic-compatible | custom"],
    ["B2", "providers.base_url TEXT；请求时拼接 /v1/chat/completions 或 /v1/messages"],
    ["B3", "agents.model_id FK → models.id"],
    ["B4", "models CRUD UI；空表初始状态，无 seed"],
    ["B5", "ChatParams.reasoningEffort → o1 reasoning / Anthropic thinking"],
    ["B6", "agents.speed_tier → max_tokens/temperature 预设映射"],
    ["B7", "api_key_ref → Keychain；永不落盘明文"],
    ["B8", "provider.test: 最小 completion 请求 + 延迟测量"],
    ["B9", "token_usage 表：prompt/completion/total per task/session"],
    ["B10", "agents.fallback_model_id chain；失败 HTTP 429/5xx 触发"],
    ["B11", "base_url http://localhost:11434/v1 等用户配置"],
    ["B12", "同 B1 custom type；文档引导"],
    ["B13", "OpenAIAdapter + AnthropicAdapter 双实现；统一 ChatChunk 流"],
]) + """
""")

# §32 Excluded
sec("sec-32-excluded", "excluded", "32. V1.0 排除项技术说明", """
      <p>以下能力在 V1 架构中<strong>不预留扩展点</strong>，避免过度设计 (Q2/Q3/Q5)：</p>
""" + table(["ID", "排除原因", "V1 替代"], [
    ["A3 全局快捷键", "需 OS 级 Hook", "托盘/吸附打开 App"],
    ["A5 自启动", "范围外", "手动启动"],
    ["A7 云同步", "纯本地", "C12 配置导出"],
    ["A9 自动更新", "范围外", "手动下载新版本"],
    ["E5 Inline 补全", "Q3 轻量 UI", "Agent 聊天驱动"],
    ["H2 Multica Client", "Q2 仅 Runtime", "外部 Multica Server"],
    ["I1-I4 系统 Hook", "Q5 V2.0", "App 内划词/粘贴"],
    ["I6-I7 日历/IM", "Q5 V2.0", "—"],
    ["I9-I10 OCR/全文搜索", "Q5 V2.0", "L21 App 内搜索"],
    ["L24 TTS", "明确排除", "D11 语音输入保留"],
    ["K3 Monaco 完整 IDE", "Q3:B", "只读预览 + Diff"],
]) + """
""")

# §33 MVP checklist
sec("sec-33-mvp-checklist", "mvp-checklist", "33. MVP 技术验收清单", """
      <ul>
        <li>Electron App macOS + Windows 可安装运行 (A1)</li>
        <li>托盘常驻 + 窗口吸附 (A2, A4)</li>
        <li>SQLite 持久化 sessions/agents/providers (A6)</li>
        <li>zh-CN / en 切换无硬编码 (A11)</li>
        <li>深/浅色主题 (A10)</li>
        <li>Provider OpenAI + Anthropic 双协议 + 自定义 model (B1-B8, B10, B13)</li>
        <li>Keychain 加密 (J1)</li>
        <li>Agent CRUD + REACT loop 执行 (F1-F6, F12-F14)</li>
        <li>read/write file + run_shell tools (E2, E3)</li>
        <li>Skills SKILL.md + MCP stdio 基础 (G1, G2, G4, G5)</li>
        <li>沙箱 + 敏感确认 (J1-J3)</li>
        <li>Task 取消/重试/流式 (L4-L6)</li>
        <li>Onboarding 向导 + 连通诊断 (L1, L3)</li>
        <li>联网搜索 (D3)</li>
        <li>对话 Markdown + 导出 (D13, D14)</li>
      </ul>
      <div class="callout"><strong>参考：</strong>产品文档 §9.1 MVP 验收标准；需求文档 §10.2。</div>
""")

# §34 Glossary
sec("sec-34-glossary", "glossary", "34. 术语表", """
""" + table(["术语", "技术定义"], [
    ["AgentEngine", "packages/core/agent 中执行 REACT loop 的主类"],
    ["ModelRouter", "按 Agent 配置路由到 Provider 并处理 Fallback 的模块"],
    ["TaskOrchestrator", "Task 创建、队列、状态机、与 Daemon 协调"],
    ["ACP", "Agent Client Protocol；Multica Runtime 首选协议族"],
    ["IPC", "Electron Main↔Renderer JSON-RPC 通信"],
    ["Workspace Pool", "daemon 预分配/回收 Task 隔离目录"],
    ["ApprovalGate", "敏感 tool 调用前阻塞等待用户确认"],
    ["jarvis-agent", "Go CLI；Multica 与本地 Daemon 的统一 Task 入口"],
]) + """
      <h3 id="sec-34-1-revision">34.1 文档修订记录</h3>
      <table>
        <thead><tr><th>版本</th><th>日期</th><th>变更</th></tr></thead>
        <tbody>
          <tr><td>V1.0-MVP</td><td>2026-08-02</td><td>初版：基于需求/产品/原型三份文档生成完整技术方案</td></tr>
        </tbody>
      </table>
""")

def main():
    content = HEAD + "".join(SECTIONS) + FOOT
    OUTPUT.write_text(content, encoding="utf-8")
    print(f"Written {OUTPUT} ({len(content)} bytes, {content.count(chr(10))} lines)")

if __name__ == "__main__":
    main()
