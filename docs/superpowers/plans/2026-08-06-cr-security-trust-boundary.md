# CR 安全信任边界整改 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 关闭 SEC-01、SEC-02、SEC-04、SEC-05、SEC-07、SEC-08、SEC-09 描述的窗口、IPC、路径、网络、密钥、插件与 Multica 远程注入信任边界。

**Architecture:** Renderer 只提交无权限标识（持久化 ID、capability token、配置 DTO），Electron main 统一执行可信窗口/origin、path capability、URL/DNS 和 SecureStorage 策略；不可信插件进入受限 utility process。Multica payload 先在 Go daemon 中形成候选注入，经本地 allowlist、审批与脱敏审计后才可生成 `RunSpec`。

**Tech Stack:** Electron 32（BrowserWindow、utilityProcess、IPC）、TypeScript 5、Node 20.11+ 标准库（`crypto`/`dns`/`net`/`path`/`fs`）、React 19、better-sqlite3、Go 标准库、Vitest、Go test。

## Global Constraints

- 当前含大量未提交改动的工作树是实施基线；不得回退、覆盖或顺手提交用户现有改动。
- 每个 Task 只暂存该 Task `Files` 列出的精确文件；禁止 `git add .`、`git add -A`、目录级宽泛暂存和通配符暂存。
- `AgentEngine`、REACT loop、`ModelRouter`、`MCPClient` 唯一实现在 `packages/core` TypeScript；Go 只做协议与调度壳。
- Renderer 只能导入 `@jarvis/core/renderer`；`packages/protocol` 不得依赖 `@jarvis/core`。
- Provider/model ID 完全由用户定义；不得硬编码默认模型。
- API Key 不得以明文进入 SQLite、WAL、备份、导出或日志；数据库与导出只保存 `apiKeyRef`。
- SQLite migration 只能追加 v13+；不得编辑已发布的 v1–v12 SQL。
- Electron main 负责 IPC、安全存储和接线；纯策略逻辑放 `packages/core`；renderer 只负责状态投影与双语 UI。
- 新增用户可见错误必须返回稳定错误码，并在 `packages/i18n/locales/zh-CN/common.json` 与 `packages/i18n/locales/en/common.json` 对称映射。
- 外部网络能力必须具备 deadline、最多 3 次重定向、每跳 URL/DNS 复检、响应上限与 `AbortSignal`。
- 新安全策略模块分支覆盖率目标不低于 90%。
- 本计划不新增第三方依赖，优先使用 Node/Go/Electron 标准能力，因此不修改任何 `package.json` 或 lockfile。若实现者认为必须新增依赖，应停止当前 Task，先单独执行 Sonatype `/check-dependency`，并取得 Developer Trust Score > 80、无 high/critical CVE、MIT/Apache-2.0/BSD 兼容许可的证据后另写计划，不得在本计划内临时引入。
- Node Vitest 与 Electron E2E 使用隔离 ABI 环境；不得通过改变测试顺序掩盖 `better-sqlite3` ABI 问题。
- 每个失败分支返回值形结果或稳定 typed error；日志不得包含 API Key、Authorization header、完整环境变量或本地文件内容。

## 文件职责总览

```text
packages/core/src/security/
├── skill-name.ts / skill-name.spec.ts          # Skill 名称、目标目录边界纯策略
└── index.ts                                    # main barrel 导出
packages/core/src/plugins/
├── protocol.ts / protocol.spec.ts              # manifest、RPC、hash/权限 DTO
└── PluginHost.ts / PluginHost.spec.ts          # 仅注册 runner 代理，不执行插件代码
apps/desktop/src/main/security/
├── TrustedRendererPolicy.ts / spec             # app URL、主窗口、主 frame 信任判断
├── PathCapabilityStore.ts / spec               # 短期、窗口绑定、操作绑定 path token
└── SafeUrlPolicy.ts / spec                     # HTTPS、DNS、IP、redirect、deadline、大小
apps/desktop/src/main/window/WindowManager.ts    # 默认拒绝导航，HTTPS 交系统浏览器
apps/desktop/src/main/ipc/
├── IpcRouter.ts / spec                         # 每个 invoke 先执行 sender/origin policy
├── mcp.ts / spec                               # mcp.test 只接收持久化 MCP id
├── register-agents-ipc.ts                      # MCP/Skill/Workspace 安全接线
├── register-coding-ipc.ts                      # 原生 picker 签发 capability
├── office.ts / spec                            # Office 只消费 capability
├── workspace.ts / spec                         # copy/bind 只消费 capability
├── skills.ts / spec                            # 安全本地/URL Skill 导入
├── providers.ts / spec                         # Provider URL 保存前执行统一策略
├── search.ts / spec                            # 搜索 ref 解密与 safeFetch
└── config.ts / spec                            # settings 导出显式 allowlist/redaction
apps/desktop/src/main/search/
└── SearchSecretMigration.ts / spec             # 历史明文四阶段迁移与阻断状态
apps/desktop/src/main/plugins/
├── PluginRunnerHost.ts / spec                  # utility process 生命周期、超时、消息上限
└── plugin-runner-child.ts                      # 静态导入拒绝、受控 VM、RPC handler
apps/desktop/src/renderer/src/
├── components/chat/MarkdownView.tsx / spec     # 仅 HTTPS 外链
├── components/office/DropZone.tsx / spec       # 不再传裸 File.path
├── components/office/SearchProvidersPage.tsx / spec
├── pages/OfficePage.tsx / spec
├── pages/PdfReaderPage.tsx / spec
├── pages/AgentDetailPage.tsx / spec
├── pages/settings/McpSettingsPage.tsx / spec
└── pages/settings/SkillsSettingsPage.tsx / spec
daemon/internal/multica/policy/
├── policy.go / policy_test.go                  # Env/CLI/MCP 候选策略
├── approvals.go / approvals_test.go            # 本地 0600 审批存储
└── audit.go / audit_test.go                    # 脱敏 JSONL 审计
daemon/internal/multica/acp/inject.go / spec     # 仅合并已批准 Injection
daemon/cmd/jarvis-agent/run.go / run_test.go     # policy gate 在 RunSpec 前执行
```

## CR Traceability

- **SEC-01:** Task 1；主窗口导航、可信窗口/main frame/origin、`sandbox:true`、HTTPS Markdown 外链、`mcp.test({ id })`。
- **SEC-02:** Task 2；Office PDF/文件分析、workspace copy/bind、Skill 本地导入、配置读取全部改为窗口绑定 path capability。
- **SEC-04:** Task 4；Skill name grammar、目标 `resolve/relative/realpath` 边界、覆盖拒绝。
- **SEC-05:** Task 3；Provider、WebView、URL Skill、搜索自定义 endpoint 复用 HTTPS + DNS/redirect SSRF policy。
- **SEC-07:** Task 5；搜索密钥 SecureStorage、幂等迁移、DB/WAL/backup/export 回归。
- **SEC-08:** Task 6；删除 main 内不可信 `vm.runInContext`，使用受限 utility process、manifest/hash/审批、RPC 限额。
- **SEC-09:** Task 7；Multica MCP/Env/CLI 候选策略、本地批准、危险项拒绝、脱敏审计。

---

### Task 1: 可信窗口、导航、IPC origin 与 `mcp.test`

**Files:**
- Create: `apps/desktop/src/main/security/TrustedRendererPolicy.ts`
- Create: `apps/desktop/src/main/security/TrustedRendererPolicy.spec.ts`
- Modify: `apps/desktop/src/main/window/WindowManager.ts`
- Modify: `apps/desktop/src/main/window/WindowManager.spec.ts`
- Modify: `apps/desktop/src/main/ipc/IpcRouter.ts`
- Modify: `apps/desktop/src/main/ipc/IpcRouter.spec.ts`
- Modify: `apps/desktop/src/main/ipc/mcp.ts`
- Modify: `apps/desktop/src/main/ipc/mcp.spec.ts`
- Modify: `apps/desktop/src/main/ipc/register-agents-ipc.ts`
- Modify: `apps/desktop/src/renderer/src/pages/settings/McpSettingsPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/settings/McpSettingsPage.spec.tsx`
- Modify: `apps/desktop/src/renderer/src/components/chat/MarkdownView.tsx`
- Create: `apps/desktop/src/renderer/src/components/chat/MarkdownView.spec.tsx`
- Modify: `apps/desktop/electron.vite.config.ts`

**Interfaces:**
- Consumes: Electron `IpcMainInvokeEvent.sender/senderFrame`、`BrowserWindow.webContents/mainFrame`、`ELECTRON_RENDERER_URL`；现有 `mcp_servers(id, transport, config_json)`。
- Produces:
  - `TrustedRendererPolicyOptions { rendererRoot: string; devOrigin?: string }`
  - `TrustedRendererPolicy.isTrustedUrl(raw: string): boolean`
  - `assertTrustedIpcEvent(event, mainWindow, policy): void`，拒绝码 `IPC_UNTRUSTED_WINDOW | IPC_UNTRUSTED_FRAME | IPC_UNTRUSTED_ORIGIN`
  - `installNavigationGuards(window, policy, openExternal): void`
  - `testMcpServerById(db, serverId, deps?): Promise<McpTestResult>`
  - renderer `mcp.test` payload 固定为 `{ id: string }`，与 V1 产品闭环计划的 MCP DTO 保持一致。

- [ ] **Step 1: 写可信 URL、窗口与 frame 失败测试**

`apps/desktop/src/main/security/TrustedRendererPolicy.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { TrustedRendererPolicy, assertTrustedIpcEvent } from './TrustedRendererPolicy';

describe('TrustedRendererPolicy', () => {
  const policy = new TrustedRendererPolicy({
    rendererRoot: '/app/out/renderer',
    devOrigin: 'http://127.0.0.1:5173',
  });

  it('allows packaged renderer files and the configured loopback dev origin only', () => {
    expect(policy.isTrustedUrl('file:///app/out/renderer/index.html')).toBe(true);
    expect(policy.isTrustedUrl('http://127.0.0.1:5173/settings')).toBe(true);
    expect(policy.isTrustedUrl('https://evil.example/')).toBe(false);
    expect(policy.isTrustedUrl('http://localhost:5173/')).toBe(false);
  });

  it('rejects a different window and a subframe', () => {
    const mainFrame = { url: 'file:///app/out/renderer/index.html' };
    const webContents = { id: 7, mainFrame };
    const mainWindow = { webContents };
    expect(() => assertTrustedIpcEvent(
      { sender: { id: 8 }, senderFrame: mainFrame } as never,
      mainWindow as never,
      policy,
    )).toThrow('IPC_UNTRUSTED_WINDOW');
    expect(() => assertTrustedIpcEvent(
      { sender: webContents, senderFrame: { url: mainFrame.url } } as never,
      mainWindow as never,
      policy,
    )).toThrow('IPC_UNTRUSTED_FRAME');
  });
});
```

- [ ] **Step 2: 运行测试并确认策略模块缺失**

Run: `cd apps/desktop && pnpm vitest run src/main/security/TrustedRendererPolicy.spec.ts`

Expected: FAIL with `Cannot find module './TrustedRendererPolicy'`。

- [ ] **Step 3: 实现最小可信 renderer policy**

`apps/desktop/src/main/security/TrustedRendererPolicy.ts`:
```ts
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface TrustedRendererPolicyOptions {
  rendererRoot: string;
  devOrigin?: string;
}

export class TrustedRendererPolicy {
  private readonly root: string;
  private readonly devOrigin?: string;
  constructor(opts: TrustedRendererPolicyOptions) {
    this.root = resolve(opts.rendererRoot);
    this.devOrigin = opts.devOrigin ? new URL(opts.devOrigin).origin : undefined;
  }
  isTrustedUrl(raw: string): boolean {
    try {
      const url = new URL(raw);
      if (url.protocol === 'file:') {
        const rel = relative(this.root, resolve(fileURLToPath(url)));
        return rel === 'index.html' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.includes(sep));
      }
      return Boolean(this.devOrigin && url.origin === this.devOrigin && ['127.0.0.1', '[::1]'].includes(url.hostname));
    } catch {
      return false;
    }
  }
}

export function assertTrustedIpcEvent(
  event: IpcMainInvokeEvent,
  mainWindow: BrowserWindow | null,
  policy: TrustedRendererPolicy,
): void {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('IPC_UNTRUSTED_WINDOW');
  if (event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('IPC_UNTRUSTED_FRAME');
  if (!policy.isTrustedUrl(event.senderFrame.url)) throw new Error('IPC_UNTRUSTED_ORIGIN');
}
```

- [ ] **Step 4: 写导航与 IPC wrapper 失败测试**

在 `WindowManager.spec.ts` 增加：捕获 `will-navigate`、`will-frame-navigate`、`setWindowOpenHandler` 回调；断言 `https://example.com` 调用 `preventDefault()` 与 `shell.openExternal`，`file:///etc/passwd` 只拒绝不打开；断言 `webPreferences.sandbox === true`。

在 `IpcRouter.spec.ts` 增加：
```ts
it('wraps every ipcMain handler with trusted main-frame enforcement', async () => {
  const mainFrame = { url: 'file:///app/out/renderer/index.html' };
  const webContents = { id: 1, mainFrame };
  const win = { webContents };
  const router = new IpcRouter(db, {
    getMainWindow: () => win as never,
    rendererRoot: '/app/out/renderer',
  });
  router.register('probe', () => 'ok');
  router.listen();
  const wrapped = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === 'probe')![1];
  await expect(wrapped({ sender: { id: 2 }, senderFrame: mainFrame } as never)).rejects.toThrow('IPC_UNTRUSTED_WINDOW');
  await expect(wrapped({ sender: webContents, senderFrame: { url: mainFrame.url } } as never)).rejects.toThrow('IPC_UNTRUSTED_FRAME');
  await expect(wrapped({ sender: webContents, senderFrame: mainFrame } as never)).resolves.toBe('ok');
});
```

- [ ] **Step 5: 运行测试并确认当前导航/IPC 无防护**

Run: `cd apps/desktop && pnpm vitest run src/main/window/WindowManager.spec.ts src/main/ipc/IpcRouter.spec.ts`

Expected: FAIL；当前 `sandbox:false`，没有 `will-navigate`/`will-frame-navigate` listener，`ipcMain.handle` 直接注册业务 handler。

- [ ] **Step 6: 接入导航、sandbox 与 IPC wrapper**

实现要点：
```ts
// WindowManager.ts
webPreferences: {
  preload: this.preloadPath(),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
}
const deny = (event: Electron.Event, url: string) => {
  if (policy.isTrustedUrl(url)) return;
  event.preventDefault();
  const parsed = new URL(url);
  if (parsed.protocol === 'https:') void shell.openExternal(parsed.toString());
};
this.main.webContents.on('will-navigate', deny);
this.main.webContents.on('will-frame-navigate', deny);
this.main.webContents.setWindowOpenHandler(({ url }) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') void shell.openExternal(parsed.toString());
  } catch {
    // Malformed targets are denied without escaping the navigation guard.
  }
  return { action: 'deny' };
});
```

`electron.vite.config.ts` 把 preload 输出固定为 CommonJS `.cjs`：
```ts
preload: {
  plugins: [externalizeDepsPlugin({ exclude: ['@jarvis/protocol'] })],
  build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
},
```

`IpcRouter.listen()` 必须注册 wrapper：
```ts
ipcMain.handle(channel, async (event, ...args) => {
  assertTrustedIpcEvent(event, this.opts.getMainWindow(), this.policy);
  return handler(event, ...args);
});
```

- [ ] **Step 7: 写 `mcp.test` ID-only 与 Markdown HTTPS 失败测试**

`mcp.spec.ts`:
```ts
it('loads the executable from the persisted server id', async () => {
  const store = createMcpStore(db);
  const saved = store.create({ name: 'fs', transport: 'stdio', command: 'approved-bin', args: ['--stdio'] });
  const commands: string[] = [];
  const result = await testMcpServerById(db, saved.id, {
    spawnImpl: (cmd) => { commands.push(cmd); return new FakeProc() as never; },
  });
  expect(result.ok).toBe(true);
  expect(commands).toEqual(['approved-bin']);
});

it('rejects an unknown id without spawning', async () => {
  const spawnImpl = vi.fn();
  await expect(testMcpServerById(db, 'missing', { spawnImpl })).resolves.toEqual({
    ok: false, tools: [], error: 'MCP_SERVER_NOT_FOUND',
  });
  expect(spawnImpl).not.toHaveBeenCalled();
});
```

`MarkdownView.spec.tsx`:
```tsx
it('renders only https links as external anchors', () => {
  const { container, rerender } = render(<MarkdownView content="[safe](https://example.com)" />);
  expect(container.querySelector('a')).toMatchObject({ target: '_blank', rel: 'noreferrer noopener' });
  rerender(<MarkdownView content="[bad](file:///etc/passwd)" />);
  expect(container.querySelector('a')).toBeNull();
  expect(container.textContent).toContain('bad');
});
```

- [ ] **Step 8: 实现 ID-only 测试与 HTTPS 链接**

`mcp.ts`:
```ts
export async function testMcpServerById(
  db: Database.Database,
  serverId: string,
  deps: { spawnImpl?: SpawnImpl } = {},
): Promise<McpTestResult> {
  const row = db.prepare('SELECT name, transport, config_json FROM mcp_servers WHERE id = ?')
    .get(serverId) as { name: string; transport: McpServerInput['transport']; config_json: string } | undefined;
  if (!row) return { ok: false, tools: [], error: 'MCP_SERVER_NOT_FOUND' };
  const cfg = JSON.parse(row.config_json) as { command?: string; args?: string[] };
  return testPersistedMcpServer({ name: row.name, transport: row.transport, ...cfg }, deps);
}
```

`register-agents-ipc.ts` 注册 `mcp.test` 为单对象 payload：
```ts
register('mcp.test', (_e, args) =>
  testMcpServerById(db, ((args ?? {}) as { id: string }).id));
```

`McpSettingsPage.tsx` 只发送：
```ts
window.jarvis.invoke('mcp.test', { id: s.id })
```

`MarkdownView.tsx` 的 `a` renderer 对非 HTTPS 返回 `<span>{children}</span>`；HTTPS 返回 `target="_blank" rel="noreferrer noopener"`。

- [ ] **Step 9: 运行 Task 1 测试与 typecheck**

Run: `cd apps/desktop && pnpm vitest run src/main/security/TrustedRendererPolicy.spec.ts src/main/window/WindowManager.spec.ts src/main/ipc/IpcRouter.spec.ts src/main/ipc/mcp.spec.ts src/renderer/src/pages/settings/McpSettingsPage.spec.tsx src/renderer/src/components/chat/MarkdownView.spec.tsx && pnpm typecheck`

Expected: PASS。

- [ ] **Step 10: 精确暂存并提交**

```bash
git add apps/desktop/src/main/security/TrustedRendererPolicy.ts apps/desktop/src/main/security/TrustedRendererPolicy.spec.ts apps/desktop/src/main/window/WindowManager.ts apps/desktop/src/main/window/WindowManager.spec.ts apps/desktop/src/main/ipc/IpcRouter.ts apps/desktop/src/main/ipc/IpcRouter.spec.ts apps/desktop/src/main/ipc/mcp.ts apps/desktop/src/main/ipc/mcp.spec.ts apps/desktop/src/main/ipc/register-agents-ipc.ts apps/desktop/src/renderer/src/pages/settings/McpSettingsPage.tsx apps/desktop/src/renderer/src/pages/settings/McpSettingsPage.spec.tsx apps/desktop/src/renderer/src/components/chat/MarkdownView.tsx apps/desktop/src/renderer/src/components/chat/MarkdownView.spec.tsx apps/desktop/electron.vite.config.ts
git commit -m "fix(desktop): enforce trusted renderer IPC and navigation boundary (SEC-01)"
```

---

### Task 2: 窗口绑定 Path Capability

**Files:**
- Create: `apps/desktop/src/main/security/PathCapabilityStore.ts`
- Create: `apps/desktop/src/main/security/PathCapabilityStore.spec.ts`
- Modify: `apps/desktop/src/main/ipc/IpcRouter.ts`
- Modify: `apps/desktop/src/main/ipc/register-coding-ipc.ts`
- Modify: `apps/desktop/src/main/ipc/register-agents-ipc.ts`
- Modify: `apps/desktop/src/main/ipc/office.ts`
- Modify: `apps/desktop/src/main/ipc/office.spec.ts`
- Modify: `apps/desktop/src/main/ipc/workspace.ts`
- Modify: `apps/desktop/src/main/ipc/workspace.spec.ts`
- Modify: `apps/desktop/src/renderer/src/components/office/DropZone.tsx`
- Modify: `apps/desktop/src/renderer/src/components/office/DropZone.spec.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/OfficePage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/OfficePage.spec.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/PdfReaderPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/AgentDetailPage.tsx`
- Modify: `apps/desktop/src/renderer/src/components/settings/ConfigImportExportView.tsx`
- Modify: `apps/desktop/src/renderer/src/components/settings/ConfigImportExportView.spec.tsx`
- Modify: `packages/protocol/src/ipc-allowlist.ts`

**Interfaces:**
- Consumes: native `dialog.showOpenDialog` result、`event.sender.id`、`realpathSync`/`lstatSync`。
- Produces:
  - `PathOperation = 'office:read' | 'workspace:copy' | 'workspace:bind' | 'skills:import-dir' | 'config:read'`
  - `PathPickPurpose = 'office-file' | 'workspace-copy' | 'workspace-bind' | 'skills-import' | 'config-import'`；main 以固定映射决定 picker kind/filter/operation，renderer 不得提交任意 operations。
  - `PathCapability { token: string; name: string; kind: 'file'|'directory'; sizeBytes: number; expiresAt: number }`
  - `PathCapabilityStore.issue(path, ownerWebContentsId, operations, ttlMs?): PathCapability`
  - `PathCapabilityStore.resolve(token, ownerWebContentsId, operation): string`
  - `PathCapabilityStore.revokeWindow(ownerWebContentsId): void`
  - `dialog.pickPath` 返回 capability（或 capability 数组），renderer 永不接收绝对路径。

- [ ] **Step 1: 写未签发、过期、跨窗口、操作错配与 symlink 失败测试**

`PathCapabilityStore.spec.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PathCapabilityStore } from './PathCapabilityStore';

describe('PathCapabilityStore', () => {
  it('binds token to canonical path, window, operation and expiry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-cap-'));
    const file = join(dir, 'report.pdf');
    writeFileSync(file, 'pdf');
    let now = 100;
    const caps = new PathCapabilityStore({ now: () => now, randomToken: () => 'token' });
    const cap = caps.issue(file, 7, ['office:read'], 50);
    expect(caps.resolve(cap.token, 7, 'office:read')).toBe(file);
    expect(() => caps.resolve(cap.token, 8, 'office:read')).toThrow('PATH_CAPABILITY_OWNER');
    expect(() => caps.resolve(cap.token, 7, 'workspace:copy')).toThrow('PATH_CAPABILITY_OPERATION');
    now = 151;
    expect(() => caps.resolve(cap.token, 7, 'office:read')).toThrow('PATH_CAPABILITY_EXPIRED');
  });

  it('detects a symlink target change after issue', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-cap-link-'));
    const a = join(dir, 'a'); const b = join(dir, 'b'); const link = join(dir, 'link');
    writeFileSync(a, 'a'); writeFileSync(b, 'b'); symlinkSync(a, link);
    const caps = new PathCapabilityStore();
    const cap = caps.issue(link, 1, ['office:read']);
    vi.spyOn(caps as never, 'canonicalize' as never).mockReturnValueOnce(b as never);
    expect(() => caps.resolve(cap.token, 1, 'office:read')).toThrow('PATH_CAPABILITY_CHANGED');
  });
});
```

- [ ] **Step 2: 运行测试并确认 capability store 缺失**

Run: `cd apps/desktop && pnpm vitest run src/main/security/PathCapabilityStore.spec.ts`

Expected: FAIL with module not found。

- [ ] **Step 3: 实现最小 capability store**

```ts
import { randomBytes } from 'node:crypto';
import { basename } from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';

export type PathOperation = 'office:read'|'workspace:copy'|'workspace:bind'|'skills:import-dir'|'config:read';
interface RecordValue { original: string; canonical: string; owner: number; operations: ReadonlySet<PathOperation>; expiresAt: number; kind: 'file'|'directory'; sizeBytes: number }

export class PathCapabilityStore {
  private readonly records = new Map<string, RecordValue>();
  constructor(private deps: { now?: () => number; randomToken?: () => string } = {}) {}
  private canonicalize(path: string): string { return realpathSync(path); }
  issue(path: string, owner: number, operations: PathOperation[], ttlMs = 5 * 60_000): PathCapability {
    const canonical = this.canonicalize(path);
    const stat = lstatSync(canonical);
    if (!stat.isFile() && !stat.isDirectory()) throw new Error('PATH_CAPABILITY_TYPE');
    const token = this.deps.randomToken?.() ?? randomBytes(32).toString('base64url');
    const value = { original: path, canonical, owner, operations: new Set(operations), expiresAt: (this.deps.now?.() ?? Date.now()) + ttlMs, kind: stat.isFile() ? 'file' as const : 'directory' as const, sizeBytes: stat.size };
    this.records.set(token, value);
    return { token, name: basename(canonical), kind: value.kind, sizeBytes: value.sizeBytes, expiresAt: value.expiresAt };
  }
  resolve(token: string, owner: number, operation: PathOperation): string {
    const value = this.records.get(token);
    if (!value) throw new Error('PATH_CAPABILITY_UNKNOWN');
    if (value.owner !== owner) throw new Error('PATH_CAPABILITY_OWNER');
    if (!value.operations.has(operation)) throw new Error('PATH_CAPABILITY_OPERATION');
    if ((this.deps.now?.() ?? Date.now()) > value.expiresAt) throw new Error('PATH_CAPABILITY_EXPIRED');
    if (this.canonicalize(value.original) !== value.canonical) throw new Error('PATH_CAPABILITY_CHANGED');
    return value.canonical;
  }
  revokeWindow(owner: number): void {
    for (const [token, value] of this.records) if (value.owner === owner) this.records.delete(token);
  }
}
```

- [ ] **Step 4: 写 Office/Workspace 裸路径拒绝测试**

`office.spec.ts`：
```ts
it('resolves office files only through a capability owned by the sender', async () => {
  const router = makeRouter();
  const resolvePath = vi.fn(() => '/fixtures/report.docx');
  registerOfficeIpc(router, { async *chat() { yield { deltaText: 'ok' }; } }, { resolvePath });
  const h = router.handlers.get('office.file.analyze')!;
  await h({ sender: { id: 9 } } as never, { capability: 'cap-1', name: 'report.docx' });
  expect(resolvePath).toHaveBeenCalledWith('cap-1', 9, 'office:read');
});
```

`workspace.spec.ts`：
```ts
it('copies only capability-resolved files', () => {
  const src = join(tmp, 'outside.txt'); writeFileSync(src, 'safe');
  const resolvePath = vi.fn(() => src);
  const ipc = createWorkspaceIpc(() => tmp, { resolvePath });
  expect(ipc.copyFiles(['cap-1'], 4)).toEqual({ ok: true });
  expect(resolvePath).toHaveBeenCalledWith('cap-1', 4, 'workspace:copy');
});
```

- [ ] **Step 5: 运行测试并确认当前 handler 仍消费裸路径**

Run: `cd apps/desktop && pnpm vitest run src/main/ipc/office.spec.ts src/main/ipc/workspace.spec.ts`

Expected: FAIL；当前签名分别为 `(path, name)` 与 `copyFiles(paths)`。

- [ ] **Step 6: 接线 native picker 与 capability-only handlers**

`register-coding-ipc.ts` 新增单对象通道：
```ts
const PICK_POLICIES: Record<PathPickPurpose, {
  kind: 'file' | 'directory';
  operations: PathOperation[];
  filters?: Electron.FileFilter[];
}> = {
  'office-file': { kind: 'file', operations: ['office:read'] },
  'workspace-copy': { kind: 'file', operations: ['workspace:copy'] },
  'workspace-bind': { kind: 'directory', operations: ['workspace:bind'] },
  'skills-import': { kind: 'directory', operations: ['skills:import-dir'] },
  'config-import': { kind: 'file', operations: ['config:read'], filters: [{ name: 'JARVIS config', extensions: ['json', 'yaml', 'yml'] }] },
};
register('dialog.pickPath', async (event, request: { purpose: PathPickPurpose; multiple?: boolean }) => {
  const policy = PICK_POLICIES[request.purpose];
  if (!policy) throw new Error('PATH_PICK_PURPOSE_INVALID');
  const r = await dialog.showOpenDialog({
    properties: policy.kind === 'directory' ? ['openDirectory'] : ['openFile', ...(request.multiple ? ['multiSelections'] as const : [])],
    filters: policy.filters ?? [],
  });
  return r.canceled ? [] : r.filePaths.map(path =>
    capabilities.issue(path, event.sender.id, policy.operations));
});
```

所有下游 handler 先以 `event.sender.id` 解析 token：
```ts
const path = resolvePath(req.capability, event.sender.id, 'office:read');
const paths = req.capabilities.map(token => resolvePath(token, event.sender.id, 'workspace:copy'));
const dir = resolvePath(req.capability, event.sender.id, 'workspace:bind');
```

`IpcRouter` 在主窗口 `closed` 时调用 `capabilities.revokeWindow(webContents.id)`。删除 `picked-file.ts` 兼容状态的使用；`config.readPickedFile` 改为 `{ capability }`。

- [ ] **Step 7: 改 renderer 为 picker/capability DTO**

`DropZone` 不再读取 `File.path`；点击/拖放均触发 `dialog.pickPath`，得到：
```ts
interface PickedCapability { token: string; name: string; kind: 'file'|'directory'; sizeBytes: number; expiresAt: number }
```

Office 调用：
```ts
window.jarvis.invoke('office.file.analyze', { capability: file.token, name: file.name })
window.jarvis.invoke('office.pdf.extract', { capability: file.token })
window.jarvis.invoke('office.pdf.summarize', { capability: file.token, from, to })
```

Workspace、Skill 本地导入、Agent workspace bind、config import 同样只传 token。删除所有 renderer `file.path` 读取和绝对路径 state。

- [ ] **Step 8: 运行安全回归、renderer 测试与 allowlist 测试**

Run: `cd apps/desktop && pnpm vitest run src/main/security/PathCapabilityStore.spec.ts src/main/ipc/office.spec.ts src/main/ipc/workspace.spec.ts src/renderer/src/components/office/DropZone.spec.tsx src/renderer/src/pages/OfficePage.spec.tsx src/renderer/src/components/settings/ConfigImportExportView.spec.tsx && cd ../../packages/protocol && pnpm vitest run`

Expected: PASS；`rg "File\\.path|\\.path\\)" apps/desktop/src/renderer/src` 不得命中 Office/Workspace/Skill/config 导入调用。

- [ ] **Step 9: 精确暂存并提交**

```bash
git add apps/desktop/src/main/security/PathCapabilityStore.ts apps/desktop/src/main/security/PathCapabilityStore.spec.ts apps/desktop/src/main/ipc/IpcRouter.ts apps/desktop/src/main/ipc/register-coding-ipc.ts apps/desktop/src/main/ipc/register-agents-ipc.ts apps/desktop/src/main/ipc/office.ts apps/desktop/src/main/ipc/office.spec.ts apps/desktop/src/main/ipc/workspace.ts apps/desktop/src/main/ipc/workspace.spec.ts apps/desktop/src/renderer/src/components/office/DropZone.tsx apps/desktop/src/renderer/src/components/office/DropZone.spec.tsx apps/desktop/src/renderer/src/pages/OfficePage.tsx apps/desktop/src/renderer/src/pages/OfficePage.spec.tsx apps/desktop/src/renderer/src/pages/PdfReaderPage.tsx apps/desktop/src/renderer/src/pages/AgentDetailPage.tsx apps/desktop/src/renderer/src/components/settings/ConfigImportExportView.tsx apps/desktop/src/renderer/src/components/settings/ConfigImportExportView.spec.tsx packages/protocol/src/ipc-allowlist.ts
git commit -m "fix(desktop): replace renderer file paths with scoped capabilities (SEC-02)"
```

---

### Task 3: 统一 URL/DNS/redirect SSRF Policy

**Files:**
- Create: `apps/desktop/src/main/security/SafeUrlPolicy.ts`
- Create: `apps/desktop/src/main/security/SafeUrlPolicy.spec.ts`
- Create: `packages/core/src/network/SafeHttpClient.ts`
- Create: `packages/core/src/network/SafeHttpClient.spec.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `apps/desktop/src/main/ipc/providers.ts`
- Modify: `apps/desktop/src/main/ipc/providers.spec.ts`
- Modify: `apps/desktop/src/main/ipc/search.ts`
- Modify: `apps/desktop/src/main/ipc/search.spec.ts`
- Modify: `apps/desktop/src/main/ipc/office.ts`
- Modify: `apps/desktop/src/main/ipc/office.spec.ts`
- Modify: `apps/desktop/src/main/webview/WebViewHost.ts`
- Modify: `apps/desktop/src/main/webview/WebViewHost.spec.ts`
- Modify: `apps/desktop/src/main/ipc/IpcRouter.ts`

**Interfaces:**
- Produces:
  - `SafeUrlPolicyOptions { allowLoopbackDev?: boolean }`；timeout/redirect/maxResponseBytes 由每次 `request(..., limits)` 显式传入，不靠 options 默认掩盖调用方遗漏。
  - `SafeFetchLimits { signal?: AbortSignal; timeoutMs: number; maxRedirects: number; maxResponseBytes: number }`
  - `SafeUrlPolicy.assertAllowed(raw, signal?): Promise<URL>`
  - core `SafeHttpClient.request(url, init, limits): Promise<Response>`；`SafeUrlPolicy` 实现该接口。Office/产品/Skill 计划只依赖 `SafeHttpClient`，不依赖 global `fetch`。
  - 错误码：`URL_HTTPS_REQUIRED`、`URL_CREDENTIALS_FORBIDDEN`、`URL_PRIVATE_ADDRESS`、`URL_REDIRECT_LIMIT`、`URL_RESPONSE_TOO_LARGE`、`URL_TIMEOUT`。
- `assertAllowed` 使用 `dns.promises.lookup(host, { all:true, verbatim:true })`；任何一个 A/AAAA 结果属于 loopback/private/link-local/unspecified/multicast/documentation/reserved 时整次拒绝。
- `request` 固定 `redirect:'manual'`，每个 `Location` 重新调用 `assertAllowed`，最多 `limits.maxRedirects` 跳（生产默认 3）。
- 防 DNS rebinding 的硬约束：实际 socket 必须使用本次已验证的地址集合。实现使用 `node:https.request` 的自定义 `lookup` 返回已验证地址，并保留原 hostname 作为 TLS `servername`/HTTP `Host`；不得在校验后再让 global `fetch`/系统 resolver 独立解析同一 hostname。

- [ ] **Step 1: 写协议、credentials、IPv4/IPv6 与 redirect 失败测试**

`SafeUrlPolicy.spec.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { SafeUrlPolicy } from './SafeUrlPolicy';

describe('SafeUrlPolicy', () => {
  it('rejects non-https, credentials and private DNS answers', async () => {
    const policy = new SafeUrlPolicy({ lookup: async () => [{ address: '10.1.2.3', family: 4 }] });
    await expect(policy.assertAllowed('http://public.example')).rejects.toThrow('URL_HTTPS_REQUIRED');
    await expect(policy.assertAllowed('https://u:p@public.example')).rejects.toThrow('URL_CREDENTIALS_FORBIDDEN');
    await expect(policy.assertAllowed('https://public.example')).rejects.toThrow('URL_PRIVATE_ADDRESS');
  });

  it.each(['127.0.0.1', '169.254.1.1', '192.168.1.2', '172.16.0.1', '::1', 'fe80::1', 'fc00::1'])(
    'rejects restricted address %s', async (address) => {
      const policy = new SafeUrlPolicy({ lookup: async () => [{ address, family: address.includes(':') ? 6 : 4 }] });
      await expect(policy.assertAllowed('https://x.example')).rejects.toThrow('URL_PRIVATE_ADDRESS');
    });

  it('revalidates redirect targets', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://internal.example/' } }));
    const policy = new SafeUrlPolicy({
      lookup: async host => [{ address: host === 'internal.example' ? '127.0.0.1' : '203.0.113.10', family: 4 }],
      fetchImpl,
    });
    await expect(policy.request('https://public.example', {}, {
      timeoutMs: 15_000, maxRedirects: 3, maxResponseBytes: 5 * 1024 * 1024,
    })).rejects.toThrow('URL_PRIVATE_ADDRESS');
  });
});
```

- [ ] **Step 2: 运行测试并确认模块缺失**

Run: `cd apps/desktop && pnpm vitest run src/main/security/SafeUrlPolicy.spec.ts`

Expected: FAIL with module not found。

- [ ] **Step 3: 用标准库实现最小 policy**

在 `packages/core/src/network/SafeHttpClient.ts` 导出：
```ts
export interface SafeFetchLimits {
  signal?: AbortSignal;
  timeoutMs: number;
  maxRedirects: number;
  maxResponseBytes: number;
}
export interface SafeHttpClient {
  request(url: string, init: RequestInit | undefined, limits: SafeFetchLimits): Promise<Response>;
}
```

实现 `isRestrictedAddress(address)`，明确覆盖：
```ts
// IPv4
0.0.0.0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12,
192.0.0/24, 192.168/16, 198.18/15, 224/4, 240/4
// IPv6
::/128, ::1/128, fc00::/7, fe80::/10, ff00::/8, IPv4-mapped restricted addresses
```

`SafeUrlPolicy.request` 使用 `node:https.request`、组合 `AbortController` 与 `setTimeout`；自定义 `lookup` 只能返回刚由 `assertAllowed` 验证的地址，TLS `servername` 固定为原 hostname。先检查 `content-length`，再逐块累计，超过 `limits.maxResponseBytes` 即 destroy socket 并抛 `URL_RESPONSE_TOO_LARGE`；把受限响应转换为标准 `Response`。调用方必须显式传入 limits；main 注入时对 Provider/搜索默认 `{ timeoutMs:15_000,maxRedirects:3,maxResponseBytes:5*1024*1024 }`。测试必须模拟“首次 DNS 为公网、第二次系统 DNS 为私网”，并断言第二次 resolver 从未被调用。

- [ ] **Step 4: 写 Provider 与 WebView policy 接线失败测试**

`providers.spec.ts`:
```ts
it('rejects a provider URL before keychain or db writes', async () => {
  const set = vi.fn();
  const store = createProviderStore(db, { set, get: async () => null, delete: async () => {} }, {
    assertAllowedUrl: async () => { throw new Error('URL_PRIVATE_ADDRESS'); },
  });
  await expect(store.create({ name: 'P', type: 'openai-compatible', baseUrl: 'https://127.0.0.1', apiKey: 'secret' }))
    .rejects.toThrow('URL_PRIVATE_ADDRESS');
  expect(set).not.toHaveBeenCalled();
  expect(store.list()).toEqual([]);
});
```

`WebViewHost.spec.ts` 断言 `open()` 在 `createWindow` 之前等待 `assertAllowedUrl`；redirect/private 错误不创建 BrowserWindow。

- [ ] **Step 5: 运行测试并确认当前 URL 仅做字符串协议判断**

Run: `cd apps/desktop && pnpm vitest run src/main/ipc/providers.spec.ts src/main/ipc/search.spec.ts src/main/ipc/office.spec.ts src/main/webview/WebViewHost.spec.ts`

Expected: FAIL；Provider 直接持久化，Office 只调用 `isHttpUrl`，搜索直接 `fetch`。

- [ ] **Step 6: 把统一 policy 注入所有 main 网络入口**

- `IpcRouter.registerAll` 构造单例 `SafeUrlPolicy`，并把它作为 core `SafeHttpClient` 注入所有需要联网的模块。
- `providers.create/update` 在写 keychain/DB 前 `await policy.assertAllowed(baseUrl)`。
- `webSearch` 对 legacy/custom endpoint 使用 `policy.request`；固定 Bing/Brave/Tavily/Serper endpoint 也经相同 client。
- `office.webview.open/summarize` 在 BrowserWindow 创建前调用 policy；删除允许 `http:` 的 `isHttpUrl` gate。
- URL Skill（Task 4）只接收该 `SafeHttpClient`，不得直接注入 global `fetch`。
- production 不允许 loopback。development/E2E 例外只能由 main 启动参数 `JARVIS_ALLOW_LOOPBACK_URLS=1` 显式开启，并在测试中断言默认关闭。

- [ ] **Step 7: 运行 URL policy 回归与 typecheck**

Run: `cd apps/desktop && pnpm vitest run src/main/security/SafeUrlPolicy.spec.ts src/main/ipc/providers.spec.ts src/main/ipc/search.spec.ts src/main/ipc/office.spec.ts src/main/webview/WebViewHost.spec.ts && pnpm typecheck`

Expected: PASS。

- [ ] **Step 8: 精确暂存并提交**

```bash
git add packages/core/src/network/SafeHttpClient.ts packages/core/src/network/SafeHttpClient.spec.ts packages/core/src/index.ts apps/desktop/src/main/security/SafeUrlPolicy.ts apps/desktop/src/main/security/SafeUrlPolicy.spec.ts apps/desktop/src/main/ipc/providers.ts apps/desktop/src/main/ipc/providers.spec.ts apps/desktop/src/main/ipc/search.ts apps/desktop/src/main/ipc/search.spec.ts apps/desktop/src/main/ipc/office.ts apps/desktop/src/main/ipc/office.spec.ts apps/desktop/src/main/webview/WebViewHost.ts apps/desktop/src/main/webview/WebViewHost.spec.ts apps/desktop/src/main/ipc/IpcRouter.ts
git commit -m "fix(desktop): enforce DNS-aware HTTPS policy for outbound URLs (SEC-05)"
```

---

### Task 4: Skill 名称边界与安全 URL 导入

**Files:**
- Create: `packages/core/src/security/skill-name.ts`
- Create: `packages/core/src/security/skill-name.spec.ts`
- Create: `packages/core/src/security/index.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/skills/SkillsLoader.ts`
- Modify: `packages/core/src/skills/SkillsLoader.spec.ts`
- Modify: `apps/desktop/src/main/ipc/skills.ts`
- Create: `apps/desktop/src/main/ipc/skills.spec.ts`
- Modify: `apps/desktop/src/main/ipc/register-agents-ipc.ts`
- Modify: `apps/desktop/src/renderer/src/pages/settings/SkillsSettingsPage.tsx`
- Create: `apps/desktop/src/renderer/src/pages/settings/SkillsSettingsPage.spec.tsx`
- Modify: `packages/protocol/src/ipc-allowlist.ts`
- Modify: `packages/i18n/locales/zh-CN/common.json`
- Modify: `packages/i18n/locales/en/common.json`

**Interfaces:**
- Produces:
  - `validateSkillName(name: string): string`，grammar 固定为 `/^[a-z0-9][a-z0-9._-]{0,63}$/`，并显式拒绝 `.`、`..`、控制字符、Unicode slash/backslash lookalike。
  - `resolveSkillTarget(root, name): string`，结果必须是 `root/<name>/SKILL.md` 且 relative 不逃逸。
  - `importSkillDocument(text, root, opts): SkillMeta`，默认 `overwrite:false`。
  - IPC `skills.importLocal { capability }` 与 `skills.importUrl { url }`。

- [ ] **Step 1: 写恶意 name 与边界失败测试**

`skill-name.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { resolveSkillTarget, validateSkillName } from './skill-name';

describe('skill name policy', () => {
  it.each(['../escape', '..', '.', '/abs', 'a/b', 'a\\b', 'a\u2215b', 'a\u0000b', ' Upper'])(
    'rejects %j', name => expect(() => validateSkillName(name)).toThrow('SKILL_NAME_INVALID'));
  it('accepts a bounded lowercase directory name', () => {
    expect(validateSkillName('code-review.v1')).toBe('code-review.v1');
    expect(resolveSkillTarget('/home/u/.jarvis/skills', 'code-review.v1'))
      .toBe('/home/u/.jarvis/skills/code-review.v1/SKILL.md');
  });
});
```

在 `SkillsLoader.spec.ts` 增加：
```ts
it('does not overwrite an existing imported skill', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-skills-'));
  mkdirSync(join(root, 'safe'), { recursive: true });
  writeFileSync(join(root, 'safe', 'SKILL.md'), 'original');
  expect(() => importSkillDocument('---\nname: safe\ndescription: x\ntriggers: []\n---\nnew', root))
    .toThrow('SKILL_EXISTS');
  expect(readFileSync(join(root, 'safe', 'SKILL.md'), 'utf8')).toBe('original');
});
```

- [ ] **Step 2: 运行测试并确认当前 frontmatter name 未受限**

Run: `cd packages/core && pnpm vitest run src/security/skill-name.spec.ts src/skills/SkillsLoader.spec.ts`

Expected: FAIL；安全模块与 `importSkillDocument` 不存在。

- [ ] **Step 3: 实现纯名称/目标策略与文档导入**

```ts
export function validateSkillName(name: string): string {
  if (name === '.' || name === '..' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name)) {
    throw new Error('SKILL_NAME_INVALID');
  }
  return name;
}

export function resolveSkillTarget(root: string, name: string): string {
  const safe = validateSkillName(name);
  const base = resolve(root);
  const targetDir = resolve(base, safe);
  const rel = relative(base, targetDir);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('SKILL_PATH_ESCAPE');
  return join(targetDir, 'SKILL.md');
}
```

`parseSkillFrontmatter` 在返回前调用 `validateSkillName`。`importSkillDocument` 先完整 parse/validate，再检查目标存在；只有通过后才 `mkdirSync`/`writeFileSync`。不得 catch 后跳过恶意 name。

- [ ] **Step 4: 写 URL Skill IPC 失败测试**

`apps/desktop/src/main/ipc/skills.spec.ts`:
```ts
it('downloads through SafeHttpClient and writes under the managed root', async () => {
  const http = {
    request: vi.fn(async () => new Response(
      '---\nname: web-import\ndescription: d\ntriggers: []\n---\nbody',
      { status: 200, headers: { 'content-type': 'text/markdown' } },
    )),
  };
  const store = createSkillsStore(db, agents, { root, http });
  const result = await store.importFromUrl('https://skills.example/SKILL.md');
  expect(http.request).toHaveBeenCalledWith(
    'https://skills.example/SKILL.md',
    expect.anything(),
    expect.objectContaining({ maxResponseBytes: 262144 }),
  );
  expect(result.path).toBe(join(root, 'web-import', 'SKILL.md'));
});

it('rejects non-markdown content before writing', async () => {
  const store = createSkillsStore(db, agents, {
    root,
    http: { request: async () => new Response('<html>x</html>', { headers: { 'content-type': 'text/html' } }) },
  });
  await expect(store.importFromUrl('https://skills.example/x')).rejects.toThrow('SKILL_CONTENT_TYPE');
});
```

- [ ] **Step 5: 接入本地 capability 与 URL 导入**

- `createSkillsStore` 接收 `{ root, resolvePath, http: SafeHttpClient }`。
- 本地目录导入先用 Task 2 的 `skills:import-dir` capability 解析；每个 meta 都走相同 `validateSkillName/resolveSkillTarget`。
- URL 导入只允许 `text/markdown` 或 `text/plain`，上限 256 KiB，复用 Task 3 `SafeHttpClient.request`。
- URL 取得的内容先写 managed root，再插入 DB；DB insert 失败时删除刚创建的目标文件，避免半完成。
- renderer 增加 URL 输入与导入按钮，错误码映射 zh-CN/en；不在 renderer 自行 fetch。

- [ ] **Step 6: 运行 Core、main、renderer 与 i18n 测试**

Run: `cd packages/core && pnpm vitest run src/security/skill-name.spec.ts src/skills/SkillsLoader.spec.ts && cd ../../apps/desktop && pnpm vitest run src/main/ipc/skills.spec.ts src/renderer/src/pages/settings/SkillsSettingsPage.spec.tsx && cd ../.. && pnpm i18n:check`

Expected: PASS。

- [ ] **Step 7: 精确暂存并提交**

```bash
git add packages/core/src/security/skill-name.ts packages/core/src/security/skill-name.spec.ts packages/core/src/security/index.ts packages/core/src/index.ts packages/core/src/skills/SkillsLoader.ts packages/core/src/skills/SkillsLoader.spec.ts apps/desktop/src/main/ipc/skills.ts apps/desktop/src/main/ipc/skills.spec.ts apps/desktop/src/main/ipc/register-agents-ipc.ts apps/desktop/src/renderer/src/pages/settings/SkillsSettingsPage.tsx apps/desktop/src/renderer/src/pages/settings/SkillsSettingsPage.spec.tsx packages/protocol/src/ipc-allowlist.ts packages/i18n/locales/zh-CN/common.json packages/i18n/locales/en/common.json
git commit -m "fix(core,desktop): contain skill names and URL imports (SEC-04)"
```

---

### Task 5: 搜索密钥迁移、阻断与导出擦除

**Files:**
- Modify: `packages/core/src/office/searchProvider.ts`
- Modify: `packages/core/src/office/searchProvider.spec.ts`
- Modify: `packages/core/src/chat/search.ts`
- Modify: `packages/core/src/chat/search.spec.ts`
- Modify: `packages/core/src/config/transfer.ts`
- Modify: `packages/core/src/config/transfer.spec.ts`
- Create: `apps/desktop/src/main/search/SearchSecretMigration.ts`
- Create: `apps/desktop/src/main/search/SearchSecretMigration.spec.ts`
- Modify: `apps/desktop/src/main/ipc/search.ts`
- Modify: `apps/desktop/src/main/ipc/search.spec.ts`
- Modify: `apps/desktop/src/main/ipc/config.ts`
- Modify: `apps/desktop/src/main/ipc/IpcRouter.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/renderer/src/components/office/SearchProvidersPage.tsx`
- Modify: `apps/desktop/src/renderer/src/components/office/SearchProvidersPage.spec.tsx`

**Interfaces:**
- `SearchProviderConfig { type: SearchProviderType; apiKeyRef: string; enabled: boolean }`；renderer DTO 额外允许一次性 `apiKey?: string` 写入，但读取永不返回 key。
- `SearchSecretMigration.run(): Promise<{ ok:true; migrated:number } | { ok:false; error:'SEARCH_SECRET_MIGRATION_REQUIRED' }>`
- `SearchProviderSecrets.getConfigs(): SearchProviderConfig[]`
- `SearchProviderSecrets.save(inputs): Promise<SearchProviderConfig[]>`
- `redactExportSettings(settings): Record<string, unknown>`，只导出显式允许键，`search_providers` 只含 `type/apiKeyRef/enabled`。

- [ ] **Step 1: 写四阶段迁移失败测试**

`SearchSecretMigration.spec.ts`:
```ts
it('writes, reads back, then transactionally removes plaintext', async () => {
  settings.set('search_providers', [{ type: 'serper', apiKey: 'search-secret-123', enabled: true }]);
  const secrets = new Map<string, string>();
  const migration = new SearchSecretMigration(db, {
    set: async (k, v) => { secrets.set(k, v); },
    get: async k => secrets.get(k) ?? null,
    delete: async k => { secrets.delete(k); },
  });
  expect(await migration.run()).toEqual({ ok: true, migrated: 1 });
  const raw = db.prepare('SELECT value_json FROM settings WHERE key = ?').get('search_providers') as { value_json: string };
  expect(raw.value_json).not.toContain('search-secret-123');
  expect(JSON.parse(raw.value_json)[0]).toMatchObject({ type: 'serper', apiKeyRef: 'search:serper:key', enabled: true });
  expect(secrets.get('search:serper:key')).toBe('search-secret-123');
});

it('keeps plaintext but blocks search when read-back confirmation fails', async () => {
  settings.set('search_providers', [{ type: 'brave', apiKey: 'keep-me', enabled: true }]);
  const migration = new SearchSecretMigration(db, {
    set: async () => {}, get: async () => null, delete: async () => {},
  });
  expect(await migration.run()).toEqual({ ok: false, error: 'SEARCH_SECRET_MIGRATION_REQUIRED' });
  expect(settings.get('search_providers')).toEqual([{ type: 'brave', apiKey: 'keep-me', enabled: true }]);
});
```

- [ ] **Step 2: 运行迁移测试并确认模块缺失**

Run: `cd apps/desktop && pnpm vitest run src/main/search/SearchSecretMigration.spec.ts`

Expected: FAIL with module not found。

- [ ] **Step 3: 实现幂等迁移与 search provider store**

迁移顺序必须固定为：
```ts
for (const cfg of legacyConfigs) {
  const ref = `search:${cfg.type}:key`;
  await secrets.set(ref, cfg.apiKey);
  if (await secrets.get(ref) !== cfg.apiKey) return blocked;
  migrated.push({ type: cfg.type, apiKeyRef: ref, enabled: cfg.enabled });
}
db.pragma('secure_delete = ON');
db.transaction(() => settings.set('search_providers', migrated))();
```

任何 `set/get/transaction` 失败都返回阻断状态，不记录 key，不删除旧值。成功移除明文后执行 `wal_checkpoint(TRUNCATE)` 与 `VACUUM`，再复扫 DB/WAL；任一清理失败保持 search blocked 并不得创建 backup/export。重复运行时只验证 refs 并返回 `migrated:0`。

保存新配置时：先写 SecureStorage、回读确认，再写无明文 settings；删除 provider 时先更新 settings，再删除对应 ref，删除失败写脱敏审计并返回可重试错误。

- [ ] **Step 4: 写 DB、WAL、backup、export 全链路无密钥测试**

在 `SearchSecretMigration.spec.ts` 使用真实临时文件 DB：
```ts
it('leaves no plaintext in db, wal, backup or export after checkpoint', async () => {
  const secret = 'search-secret-never-on-disk';
  // 建库、写 legacy、run migration、wal_checkpoint(TRUNCATE)、BackupService.createBackup()
  for (const file of [dbPath, `${dbPath}-wal`, backupPath].filter(existsSync)) {
    expect(readFileSync(file).includes(Buffer.from(secret))).toBe(false);
  }
  const exported = createConfigIpc(db).exportConfig('json');
  expect(exported).not.toContain(secret);
  expect(exported).toContain('search:serper:key');
});
```

`transfer.spec.ts`:
```ts
it('redacts secret-shaped settings and preserves search refs', () => {
  expect(redactExportSettings({
    search_providers: [{ type: 'serper', apiKey: 'secret', apiKeyRef: 'search:serper:key', enabled: true }],
    image: { apiKey: 'secret-2' },
    concurrency: { perAgent: 2 },
  })).toEqual({
    search_providers: [{ type: 'serper', apiKeyRef: 'search:serper:key', enabled: true }],
    concurrency: { perAgent: 2 },
  });
});
```

- [ ] **Step 5: 改搜索运行时与 renderer DTO**

- `buildSearchRequest` 改为接收运行时 `{ type, apiKey, enabled }`，持久化类型不含 `apiKey`。
- `webSearch` 从 settings 取 `apiKeyRef`，再经注入的 `secrets.get(ref)` 获取 key；缺 ref/key 或 migration blocked 返回 `SEARCH_API_KEY_REQUIRED`/`SEARCH_SECRET_MIGRATION_REQUIRED`。
- `SearchProvidersPage` 改用 `search.providers.get/set`；get 返回空 password 输入与 `hasKey`，set 只在用户输入非空时携带新 key。
- `config.loadPayload` 调用 `redactExportSettings(readSettings())`，禁止导出全部 settings 原样对象。
- `bootstrap()` 在窗口/IPC 就绪前执行迁移；失败状态注入 search handlers，但不阻止 App 打开。

- [ ] **Step 6: 运行密钥、导出、renderer 与 typecheck**

Run: `cd packages/core && pnpm vitest run src/office/searchProvider.spec.ts src/chat/search.spec.ts src/config/transfer.spec.ts && cd ../../apps/desktop && pnpm vitest run src/main/search/SearchSecretMigration.spec.ts src/main/ipc/search.spec.ts src/renderer/src/components/office/SearchProvidersPage.spec.tsx && pnpm typecheck`

Expected: PASS。

- [ ] **Step 7: 精确暂存并提交**

```bash
git add packages/core/src/office/searchProvider.ts packages/core/src/office/searchProvider.spec.ts packages/core/src/chat/search.ts packages/core/src/chat/search.spec.ts packages/core/src/config/transfer.ts packages/core/src/config/transfer.spec.ts apps/desktop/src/main/search/SearchSecretMigration.ts apps/desktop/src/main/search/SearchSecretMigration.spec.ts apps/desktop/src/main/ipc/search.ts apps/desktop/src/main/ipc/search.spec.ts apps/desktop/src/main/ipc/config.ts apps/desktop/src/main/ipc/IpcRouter.ts apps/desktop/src/main/index.ts apps/desktop/src/renderer/src/components/office/SearchProvidersPage.tsx apps/desktop/src/renderer/src/components/office/SearchProvidersPage.spec.tsx
git commit -m "fix(desktop): migrate search credentials into secure storage (SEC-07)"
```

---

### Task 6: 受限独立 Plugin Runner

**Files:**
- Create: `packages/core/src/plugins/protocol.ts`
- Create: `packages/core/src/plugins/protocol.spec.ts`
- Modify: `packages/core/src/plugins/PluginHost.ts`
- Modify: `packages/core/src/plugins/PluginHost.spec.ts`
- Create: `apps/desktop/src/main/plugins/PluginRunnerHost.ts`
- Create: `apps/desktop/src/main/plugins/PluginRunnerHost.spec.ts`
- Create: `apps/desktop/src/main/plugins/plugin-runner-child.ts`
- Modify: `apps/desktop/electron.vite.config.ts`
- Modify: `apps/desktop/src/main/index.ts`

**Interfaces:**
- Plugin 包：`plugin.json` + 预编译单文件 JavaScript entry；JARVIS 不运行 TypeScript compiler、package manager 或 install script。
- `PluginManifest { schemaVersion:1; id:string; name:string; entry:string; permissions: PluginPermission[] }`
- `PluginPermission = 'workspace:read' | 'workspace:write' | 'model:invoke'`
- `PluginDescriptor { manifest; root; entryPath; sha256 }`
- RPC：`ready | register | invoke | result | error | shutdown`，每帧 JSON 编码后不超过 256 KiB。
- `PluginRunnerHost.load(descriptor, approvedHash): Promise<RegisteredPluginTool[]>`
- `PluginRunnerHost.invoke(tool, args, context): Promise<ToolResult>`；默认启动 2s、调用 5s、内存 64 MiB。

- [ ] **Step 1: 写 manifest、entry containment 与静态 import 失败测试**

`protocol.spec.ts`:
```ts
it('accepts a contained single-file entry and stable hash', () => {
  const d = describePlugin('/plugins/p1', {
    readText: p => p.endsWith('plugin.json')
      ? '{"schemaVersion":1,"id":"p1","name":"P1","entry":"index.js","permissions":[]}'
      : 'registerTool({name:"hello",description:"",parameters:{}}, async()=>({ok:true,output:"hi"}));',
    realpath: p => p,
  });
  expect(d.entryPath).toBe('/plugins/p1/index.js');
  expect(d.sha256).toMatch(/^[a-f0-9]{64}$/);
});

it.each(['../escape.js', '/tmp/x.js'])('rejects entry %s', entry => {
  expect(() => validatePluginManifest({ schemaVersion: 1, id: 'p', name: 'P', entry, permissions: [] }))
    .toThrow('PLUGIN_ENTRY_INVALID');
});

it.each(['import fs from "node:fs"', 'await import("node:fs")', 'require("fs")'])(
  'rejects imports: %s', code => expect(() => assertStaticPluginCode(code)).toThrow('PLUGIN_IMPORT_FORBIDDEN'));
```

- [ ] **Step 2: 运行 Core plugin 测试并确认协议不存在**

Run: `cd packages/core && pnpm vitest run src/plugins/protocol.spec.ts src/plugins/PluginHost.spec.ts`

Expected: FAIL with missing exports；旧 `PluginHost` 仍在当前进程执行 `vm.runInContext`。

- [ ] **Step 3: 实现 manifest/protocol 与代理型 PluginHost**

`PluginHost.ts` 不再导入 `node:vm`。最小接口：
```ts
export interface PluginRunner {
  load(descriptor: PluginDescriptor): Promise<RegisteredPluginTool[]>;
  invoke(pluginId: string, tool: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
  close(pluginId: string): Promise<void>;
}

export function createPluginHost(registry: ToolRegistry, runner: PluginRunner) {
  return {
    async load(descriptor: PluginDescriptor): Promise<void> {
      for (const tool of await runner.load(descriptor)) {
        registry.register(tool.definition, (args, ctx) => runner.invoke(descriptor.manifest.id, tool.definition.name, args, ctx));
      }
    },
  };
}
```

- [ ] **Step 4: 写 runner 无限循环、超大消息、崩溃与 hash 审批失败测试**

`PluginRunnerHost.spec.ts` 使用 fake utility child：
```ts
it('kills an invocation that exceeds the deadline and rejects all pending calls', async () => {
  const child = new FakeUtilityChild();
  const host = new PluginRunnerHost({ fork: () => child, approval: async () => true, invokeTimeoutMs: 20 });
  await host.load(descriptor, descriptor.sha256);
  const pending = host.invoke('p1', 'hang', {}, { cwd: '/ws', env: {} });
  await expect(pending).rejects.toThrow('PLUGIN_TIMEOUT');
  expect(child.kill).toHaveBeenCalled();
  expect(host.pendingCount()).toBe(0);
});

it('refuses a changed hash before process start', async () => {
  const fork = vi.fn();
  const host = new PluginRunnerHost({ fork, approval: async (_d, hash) => hash === 'approved' });
  await expect(host.load(descriptor, 'old-hash')).rejects.toThrow('PLUGIN_APPROVAL_REQUIRED');
  expect(fork).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: 实现 utility process host 与 child**

Host：
- host 读取并 hash 已批准的单文件源码，再通过首帧 RPC 发送；child 不接收源码路径。
- `utilityProcess.fork(childEntry, [], { execArgv:['--experimental-permission','--no-addons','--max-old-space-size=64'], env:{} })`；Node permission model 不授予 fs/net/child_process/worker 权限。若当前 Electron/Node 组合不能强制 permission model，Plugin 功能必须 fail closed 为 `PLUGIN_SANDBOX_UNAVAILABLE`，不得回退到普通 utility process。
- 启动前展示/审批 `{ sourcePath, sha256, permissions }`；批准值必须等于当前 hash。
- 只把 manifest 已声明且用户批准的 capability 代理进 `ToolContext`；不发送完整 `process.env`。
- 长度检查在 JSON parse 前执行；child `exit/error` 统一 reject pending 并清空 Map。

Child：
```ts
const code = await receiveApprovedSourceFrame();
assertStaticPluginCode(code);
const context = vm.createContext(Object.freeze({
  registerTool,
  console: Object.freeze({ log: () => {}, error: () => {} }),
}));
new vm.Script(`"use strict";\n${code}`, { filename: 'plugin-entry.js' })
  .runInContext(context, { timeout: 1000 });
```

context 不暴露 `process`、`require`、`fetch`、`WebSocket`、timer、Buffer、dynamic import callback。插件 handler 只能通过结构化 RPC 使用批准的 `ToolContext` capability；调用超时由 host kill 整个 utility process。除 fake-child 单测外，增加真实 runner 集成测试：恶意插件分别尝试 constructor escape 后读取文件、发起网络、spawn 子进程，三者都必须被 permission model 拒绝，且 Electron main 仍响应 probe IPC。

- [ ] **Step 6: 配置独立 child 构建入口并接生命周期**

`electron.vite.config.ts` 给 main Rollup 增加命名 input：
```ts
input: {
  index: resolve(__dirname, 'src/main/index.ts'),
  'plugin-runner-child': resolve(__dirname, 'src/main/plugins/plugin-runner-child.ts'),
}
```

`main/index.ts` 在 `will-quit` 调 `pluginRunner.closeAll()`。不得把 child bundle 导入 renderer/preload。

- [ ] **Step 7: 运行 Core、desktop、build 与主进程扫描**

Run: `cd packages/core && pnpm vitest run src/plugins && cd ../../apps/desktop && pnpm vitest run src/main/plugins && pnpm build && ! rg "runInContext\\(code" src/main packages/core/src`

Expected: PASS；构建产物包含独立 `plugin-runner-child`；main/core 不再直接执行插件源码。

- [ ] **Step 8: 精确暂存并提交**

```bash
git add packages/core/src/plugins/protocol.ts packages/core/src/plugins/protocol.spec.ts packages/core/src/plugins/PluginHost.ts packages/core/src/plugins/PluginHost.spec.ts apps/desktop/src/main/plugins/PluginRunnerHost.ts apps/desktop/src/main/plugins/PluginRunnerHost.spec.ts apps/desktop/src/main/plugins/plugin-runner-child.ts apps/desktop/electron.vite.config.ts apps/desktop/src/main/index.ts
git commit -m "fix(core,desktop): isolate plugins in a restricted runner process (SEC-08)"
```

---

### Task 7: Multica MCP/Env/CLI 注入策略、审批与审计

**Files:**
- Create: `daemon/internal/multica/policy/policy.go`
- Create: `daemon/internal/multica/policy/policy_test.go`
- Create: `daemon/internal/multica/policy/approvals.go`
- Create: `daemon/internal/multica/policy/approvals_test.go`
- Create: `daemon/internal/multica/policy/audit.go`
- Create: `daemon/internal/multica/policy/audit_test.go`
- Modify: `daemon/internal/multica/acp/inject.go`
- Modify: `daemon/internal/multica/acp/inject_test.go`
- Modify: `daemon/cmd/jarvis-agent/run.go`
- Modify: `daemon/cmd/jarvis-agent/run_test.go`
- Modify: `daemon/internal/httpapi/server.go`
- Create: `daemon/internal/httpapi/injection_approvals_test.go`
- Create: `apps/desktop/src/main/daemon/InjectionApprovalClient.ts`
- Create: `apps/desktop/src/main/daemon/InjectionApprovalClient.spec.ts`
- Modify: `apps/desktop/src/main/ipc/IpcRouter.ts`
- Modify: `apps/desktop/src/renderer/src/pages/settings/DaemonManagementPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/settings/DaemonManagementPage.spec.tsx`
- Modify: `packages/protocol/src/ipc-allowlist.ts`
- Modify: `packages/i18n/locales/zh-CN/common.json`
- Modify: `packages/i18n/locales/en/common.json`

**Interfaces:**
- `CandidateInjection { MCPServers; Skills; Env; CLIArgs }` 只表示远端候选，不可直接进入 `RunSpec`。
- `PolicyConfig { AllowedMCPRoots []string; AllowedCLIFlags []string; AllowedEnv []string }`
- `ApprovalKey { Kind string; Name string; Digest string }`
- `ApprovalStore.IsApproved(ctx, key) (bool,error)` / `Approve(ctx,key) error`，文件 mode `0600`，atomic rename。
- `Evaluator.Evaluate(ctx, candidate) (acp.Injection, []Denial, []ApprovalRequest, error)`
- `InjectionAudit.Write(InjectionAuditEntry) error`；只记录 name、digest、允许/拒绝原因，不记录 env value 或完整 args value。
- `ExecuteTask` 只有在 `len(denials)==0 && len(approvals)==0` 时创建 `RunSpec`；否则返回 `MULTICA_INJECTION_DENIED` 或 `MULTICA_INJECTION_APPROVAL_REQUIRED`。
- daemon 暴露 authenticated `GET /v1/runtime/injection-approvals` 与 `POST /v1/runtime/injection-approvals/{digest}`；POST 只能批准当前 pending 中完全匹配的 kind/name/digest，批准后任务仍需显式 retry，不自动执行旧 payload。

- [ ] **Step 1: 写危险 Env、CLI 与 MCP executable 失败测试**

`policy_test.go`:
```go
func TestEvaluateRejectsDangerousEnvAndUndeclaredCLI(t *testing.T) {
	e := NewEvaluator(PolicyConfig{
		AllowedEnv: []string{"LOG_LEVEL"},
		AllowedCLIFlags: []string{"--verbose"},
	}, fakeApprovals{})
	_, denials, approvals, err := e.Evaluate(context.Background(), CandidateInjection{
		Env: map[string]string{"NODE_OPTIONS": "--require /tmp/pwn.js", "LOG_LEVEL": "debug"},
		CLIArgs: []string{"--verbose", "--config=/tmp/pwn"},
	})
	if err != nil { t.Fatal(err) }
	if len(approvals) != 0 { t.Fatalf("unexpected approvals: %#v", approvals) }
	assertDenial(t, denials, "NODE_OPTIONS", "DANGEROUS_ENV")
	assertDenial(t, denials, "--config", "CLI_FLAG_NOT_ALLOWED")
}

func TestEvaluateRequiresApprovalForAllowedMCPDigest(t *testing.T) {
	e := NewEvaluator(PolicyConfig{AllowedMCPRoots: []string{"/opt/jarvis/mcp"}}, fakeApprovals{})
	_, denials, approvals, err := e.Evaluate(context.Background(), CandidateInjection{
		MCPServers: []acp.MCPEntry{{Name: "fs", Command: "/opt/jarvis/mcp/fs-server"}},
	})
	if err != nil { t.Fatal(err) }
	if len(denials) != 0 || len(approvals) != 1 || approvals[0].Key.Name != "fs" {
		t.Fatalf("want one local approval: denials=%#v approvals=%#v", denials, approvals)
	}
}
```

- [ ] **Step 2: 运行 policy 测试并确认包缺失**

Run: `cd daemon && go test ./internal/multica/policy`

Expected: FAIL with package/files missing。

- [ ] **Step 3: 实现本地 policy evaluator**

固定危险 env denylist：
```go
NODE_OPTIONS, NODE_PATH, LD_PRELOAD, LD_LIBRARY_PATH, DYLD_INSERT_LIBRARIES,
DYLD_LIBRARY_PATH, PYTHONPATH, RUBYOPT, PERL5OPT, BASH_ENV, ENV, GIT_SSH_COMMAND,
HTTP_PROXY, HTTPS_PROXY, ALL_PROXY
```

执行规则：
1. Env key 必须同时不在 denylist 且存在于 `AllowedEnv`；value 不进入审计。
2. CLI 每项解析出 `--flag`；必须在 `AllowedCLIFlags`，禁止位置参数和 `@response-file`。
3. MCP command 必须是绝对路径；`EvalSymlinks` 后位于某个 `AllowedMCPRoots`；必须 regular file、非 group/world writable。
4. 对 executable 内容计算 SHA-256；`ApprovalStore` 未批准 `{kind:"mcp",name,digest}` 时只生成 approval request，不进入有效 Injection。
5. MCP env 复用同一 Env policy，args 复用 CLI policy。

- [ ] **Step 4: 写审批文件权限、原子更新与脱敏审计测试**

`approvals_test.go`:
```go
func TestFileApprovalStoreWrites0600AndRoundTrips(t *testing.T) {
	path := filepath.Join(t.TempDir(), "approvals.json")
	store := NewFileApprovalStore(path)
	key := ApprovalKey{Kind: "mcp", Name: "fs", Digest: strings.Repeat("a", 64)}
	if err := store.Approve(context.Background(), key); err != nil { t.Fatal(err) }
	info, err := os.Stat(path); if err != nil { t.Fatal(err) }
	if info.Mode().Perm() != 0o600 { t.Fatalf("mode=%o", info.Mode().Perm()) }
	ok, err := store.IsApproved(context.Background(), key)
	if err != nil || !ok { t.Fatalf("approved=%v err=%v", ok, err) }
}
```

`audit_test.go`:
```go
func TestAuditOmitsEnvValuesAndRawArgs(t *testing.T) {
	var out bytes.Buffer
	a := NewJSONLAudit(&out)
	err := a.Write(InjectionAuditEntry{
		TaskID: "t1", Kind: "env", Name: "TOKEN", Result: "denied",
		Reason: "ENV_NOT_ALLOWED", Digest: "abc",
	})
	if err != nil { t.Fatal(err) }
	if strings.Contains(out.String(), "super-secret") || strings.Contains(out.String(), "--password") {
		t.Fatalf("sensitive material in audit: %s", out.String())
	}
}
```

- [ ] **Step 5: 实现 0600 approval store 与 JSONL audit**

- 写临时文件 `path+".tmp"`，`OpenFile(..., 0600)`、`Sync`、`Close`、`Rename`；读取时拒绝 group/world-readable 文件。
- approval JSON 只保存 `kind/name/digest/approvedAt`。
- audit entry 固定字段：`ts/taskId/source/kind/name/digest/result/reason`；禁止自由文本 detail。

- [ ] **Step 6: 写 ExecuteTask policy gate 失败测试**

`run_test.go`:
```go
func TestExecuteTaskDoesNotRunUnapprovedRemoteMCP(t *testing.T) {
	runner := &fakeRunner{res: RunResult{Status: "completed"}}
	deps, _ := testDeps(runner, &fakeHistory{}, &fakeRecorder{}, &fakeProfiles{})
	deps.InjectionPolicy = rejectingPolicy{approval: policy.ApprovalRequest{
		Key: policy.ApprovalKey{Kind: "mcp", Name: "remote", Digest: "abc"},
	}}
	payload := &acp.TaskPayload{
		TaskID: "t-policy", Instruction: "go",
		MCPServers: []acp.MCPEntry{{Name: "remote", Command: "/tmp/remote"}},
	}
	err := ExecuteTask(context.Background(), deps, payload, TaskOpts{}, runtime.NewStreamWriter(io.Discard))
	if err == nil || !strings.Contains(err.Error(), "MULTICA_INJECTION_APPROVAL_REQUIRED") {
		t.Fatalf("err=%v", err)
	}
	if len(runner.specs) != 0 { t.Fatal("runner must not receive an unapproved injection") }
}
```

- [ ] **Step 7: 在 Merge/RunSpec 前接入 candidate → policy → audit**

`RunDeps` 增加，并与 task/daemon lifecycle 计划统一为同一个接口：
```go
InjectionPolicy interface {
	Evaluate(context.Context, policy.CandidateInjection) (acp.Injection, []policy.Denial, []policy.ApprovalRequest, error)
}
InjectionAudit interface { Write(policy.InjectionAuditEntry) error }
InjectionSource interface { ForAgent(context.Context, string) (acp.Injection, error) }
```

`ExecuteTask` 顺序固定为：
1. 从 `InjectionSource.ForAgent` 取得本地 snapshot。
2. 把 payload MCP/Env/CLI/Skills 转为 `CandidateInjection`。
3. `Evaluate`；逐条写脱敏 audit。
4. 有 denial/approval 时在 workspace allocation 和 `Runner.Run` 前返回稳定错误。
5. 只把 evaluator 返回的 remote injection 传给 `acp.MergeInjections(local, approvedRemote)`。
6. 同名 MCP/Skill 冲突仍由 L38 冲突流程处理，不允许 remote 覆盖 local。

删除当前 `payload.Env` 与 `payload.CLIArgs` 直接进入 `MergeInjections/RunSpec` 的路径。

- [ ] **Step 8: 接入可操作的本地审批闭环**

- evaluator 产生 approval request 时写入并发安全的 pending store；只保存 kind/name/digest/taskId/createdAt，不保存 env value 或 raw args。
- daemon 两个 authenticated API 列出 pending 与批准精确 digest；未知/过期 digest 返回 404/409。
- main typed client 与 IPC 仅转发结构化 DTO；renderer Daemon Management 页面展示来源、名称、digest，用户确认后批准。批准成功提示用户 retry 原任务。
- 增加 HTTP 未认证拒绝、digest 替换攻击、renderer 无 secret/raw args、批准后 retry 才执行的测试，并运行 `pnpm i18n:check`。

- [ ] **Step 9: 运行 Go unit、race 与危险字符串扫描**

Run: `cd daemon && go test ./internal/multica/policy ./internal/multica/acp ./cmd/jarvis-agent && go test -race ./internal/multica/policy ./internal/multica/acp ./cmd/jarvis-agent`

Expected: PASS。

Run: `rg "payload\\.(Env|CLIArgs|MCPServers)" daemon/cmd/jarvis-agent/run.go`

Expected: 只命中 `CandidateInjection` 构造；不得命中 `RunSpec`、`MergeInjections` 或 `cmd.Env` 直接赋值。

- [ ] **Step 10: 精确暂存并提交**

```bash
git add daemon/internal/multica/policy/policy.go daemon/internal/multica/policy/policy_test.go daemon/internal/multica/policy/approvals.go daemon/internal/multica/policy/approvals_test.go daemon/internal/multica/policy/audit.go daemon/internal/multica/policy/audit_test.go daemon/internal/multica/acp/inject.go daemon/internal/multica/acp/inject_test.go daemon/cmd/jarvis-agent/run.go daemon/cmd/jarvis-agent/run_test.go daemon/internal/httpapi/server.go daemon/internal/httpapi/injection_approvals_test.go apps/desktop/src/main/daemon/InjectionApprovalClient.ts apps/desktop/src/main/daemon/InjectionApprovalClient.spec.ts apps/desktop/src/main/ipc/IpcRouter.ts apps/desktop/src/renderer/src/pages/settings/DaemonManagementPage.tsx apps/desktop/src/renderer/src/pages/settings/DaemonManagementPage.spec.tsx packages/protocol/src/ipc-allowlist.ts packages/i18n/locales/zh-CN/common.json packages/i18n/locales/en/common.json
git commit -m "fix(daemon): gate Multica injections with local policy and approval (SEC-09)"
```

---

## 最终验收

- [ ] **Step 1: 逐项核对 CR**

确认：
- SEC-01：远程/错误窗口/subframe invoke 均拒绝；导航不会替换主窗口文档；`mcp.test` 只收 `{ id }`。
- SEC-02：renderer 不再向 Office/Workspace/Skill/config IPC 传绝对路径。
- SEC-04：`../`、绝对路径、Unicode 分隔符、symlink/覆盖均拒绝。
- SEC-05：HTTP、credentials、private/loopback/link-local、恶意 redirect 均拒绝。
- SEC-07：测试 key 不存在于 DB/WAL/backup/export/log。
- SEC-08：无限循环插件超时并回收，不阻塞 Electron main；hash 变化需重新批准。
- SEC-09：危险 Env、未声明 CLI、越界/未批准 MCP 不进入 `RunSpec`，审计无敏感 value。

- [ ] **Step 2: 运行安全定向测试**

Run:
```bash
cd apps/desktop && pnpm vitest run src/main/security src/main/ipc/mcp.spec.ts src/main/ipc/office.spec.ts src/main/ipc/workspace.spec.ts src/main/ipc/skills.spec.ts src/main/ipc/providers.spec.ts src/main/ipc/search.spec.ts src/main/search src/main/plugins src/main/window/WindowManager.spec.ts src/renderer/src/components/chat/MarkdownView.spec.tsx src/renderer/src/components/office/DropZone.spec.tsx src/renderer/src/components/office/SearchProvidersPage.spec.tsx src/renderer/src/pages/settings/McpSettingsPage.spec.tsx src/renderer/src/pages/settings/SkillsSettingsPage.spec.tsx
cd ../../packages/core && pnpm vitest run src/security src/skills src/plugins src/config src/office/searchProvider.spec.ts src/chat/search.spec.ts
cd ../../daemon && go test -race ./internal/multica/policy ./internal/multica/acp ./cmd/jarvis-agent
```

Expected: PASS。

- [ ] **Step 3: 运行仓库级验证**

Run:
```bash
pnpm typecheck
pnpm test
pnpm i18n:check
pnpm build
cd daemon && go test ./... && go test -race ./...
```

Expected: PASS；若 Desktop Vitest 因当前 `better-sqlite3` ABI 阻断，记录原始错误并按工程质量计划先恢复隔离 ABI，禁止把 ABI 失败写成业务测试通过。

- [ ] **Step 4: 检查 staged 边界**

Run: `git diff --cached --name-only`

Expected: 空；本计划七个 Task 已各自精确提交，没有遗留 staged 文件，也没有夹带初始脏工作树文件。

本计划不创建最终汇总提交；七个 Task 的独立提交即为 SEC-01/02/04/05/07/08/09 的审计证据。
