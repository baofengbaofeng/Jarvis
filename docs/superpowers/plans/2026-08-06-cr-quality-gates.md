# CR 工程质量门禁整改实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 STD-01、STD-02、STD-03、DOC-01、TEST-01、TEST-02、TEST-03、TEST-04、SEC-06，使 lint、format、typecheck、Node unit、覆盖率、Go race、i18n、build、Electron E2E 与生产依赖审计成为可重复的 PR 门禁。

**Architecture:** 协议层成为 IPC channel/event 的唯一字符串来源；Desktop 单测拆成 `main/node` 与 `renderer/jsdom` 两个 Vitest project，并按 core/main/renderer-store 三个覆盖域分别执行阈值。Node unit 与 Electron E2E 在不同 CI job 的全新安装中重建 `better-sqlite3`，本地脚本也在每次入口主动重建目标 ABI。Playwright 使用独立 TypeScript 配置、顶层 web server 和本地 mock OpenAI-compatible Provider，真实启动 Electron main/preload/SQLite 后完成 S2 文件、Shell 与任务终态旅程。

**Tech Stack:** TypeScript 5.9、ESLint 9 flat config、Prettier 3、Vitest 2.1.9 + V8 coverage、Playwright 1.62、Electron 32、better-sqlite3 11、pnpm 9.12、Turborepo 2、GitHub Actions、Go race detector。

## Global Constraints

- 当前工作树包含大量既有未提交修改；每个 Task 只暂存本 Task 的精确文件，提交前必须运行 `git diff --cached --name-only` 和 `git diff --cached`，不得覆盖或夹带用户改动。
- Node 版本下限保持 `>=20.11.0`，pnpm 固定 `9.12.0`；因此使用 ESLint 9，不使用要求更高 Node floor 的 ESLint 10。
- Renderer 只能导入 `@jarvis/core/renderer`，不能导入 `@jarvis/core` full barrel；`packages/protocol` 不得依赖 `@jarvis/core`。
- Provider/model ID 由用户定义；仅测试 fixture 可使用 `e2e-model`，生产代码、模板和 seed 不得出现默认模型 ID。
- API Key 不得明文落盘；E2E 的 `sk-e2e-local-only` 仅通过真实 SecureStorage 路径保存到隔离临时目录，测试结束删除整个目录。
- SQLite migration v1–v12 不修改；本计划不需要 schema migration。
- 新增 UI 文案必须同时更新 zh-CN/en；本计划不新增用户可见文案。
- Core 覆盖率阈值：85% lines、80% branches；main：80% lines、75% branches；renderer stores：90% lines、85% branches。
- Node unit 与 Electron E2E 必须在隔离 CI job 中执行，不共享重建后的原生模块；任何 job 都不能依赖其他测试 job 的执行顺序。
- 本计划依赖安全、Engine/Tool、Task、Office 和产品闭环 plans 提供稳定主路径；尤其真实 S2 E2E 依赖 structured tool turn，最终 audit 门禁依赖移除 `xlsx@0.18.5`。

## CR 覆盖与文件结构

| CR | 主 Task | 验收证据 |
|---|---:|---|
| TEST-01 | 1 | `pnpm typecheck` 为 0 error |
| SEC-06 | 2 | item-not-found 返回 null，权限/启动/其他 Keychain 错误抛稳定错误码 |
| STD-02 | 3 | channel 字符串只存在于 `ipc-channels.ts` 与负向测试 fixture |
| STD-03 | 3 | 删除 `router.tsx` 和 `@tanstack/react-router` |
| DOC-01 | 3 | AgentEngine 注释描述当前 tools 注入不变量 |
| STD-01 | 4、10 | lint/format/coverage/CI 全部存在且阻断失败 |
| TEST-02 | 5、6 | 三个覆盖域达到 spec 阈值 |
| TEST-04 | 5、8 | main/renderer Vitest project 与 Playwright/config tsconfig 独立 |
| TEST-03 | 7、8、9、10 | ABI 隔离、有效 Playwright config、真实 mock Provider S2、PR E2E |

新增文件职责：

- `eslint.config.mjs`：全仓 TypeScript/React/Electron 安全 lint 规则。
- `.prettierrc.json`、`.prettierignore`：稳定格式与排除生成物。
- `packages/core/vitest.config.ts`：core coverage 域及阈值。
- `apps/desktop/vitest.main.config.ts`：Node 环境的 main specs 与 main coverage。
- `apps/desktop/vitest.renderer.config.ts`：jsdom 环境的 renderer specs 与 store coverage。
- `apps/desktop/vitest.workspace.ts`：声明 `main`、`renderer` 两个独立 project。
- `apps/desktop/tsconfig.config.json`：Vite/Vitest/Playwright 配置类型检查。
- `apps/desktop/tsconfig.e2e.json`：Playwright specs/helpers 类型检查。
- `apps/desktop/e2e/helpers/mock-provider.ts`：进程内、loopback-only 的 OpenAI-compatible SSE mock。
- `.github/workflows/pr-quality.yml`：PR/push 质量门禁，Node ABI 与 Electron ABI 分 job。

---

### Task 1: 修复现有 TypeScript 门禁

**Files:**
- Modify: `packages/core/src/agent/AgentEngine.spec.ts:1-80`
- Modify: `packages/core/src/model/adapters/adapters.spec.ts:1-46`

**Interfaces:**
- Consumes: `EngineChatFn`、`ChatRequest`、全局 `fetch` 签名。
- Produces: 无宽泛 `unknown` 回避的强类型 mock；生产接口不变。

- [ ] **Step 1: 固化当前失败证据**

Run:

```bash
corepack pnpm --filter @jarvis/core exec tsc --noEmit --pretty false
```

Expected: FAIL，且只报告：

```text
AgentEngine.spec.ts(79,22): Property 'tools' does not exist on type 'never'
AgentEngine.spec.ts(79,33): Parameter 't' implicitly has an 'any' type
adapters.spec.ts(38,58): fetchImpl signature is incompatible
adapters.spec.ts(45,13): conversion of null may be a mistake
```

- [ ] **Step 2: 用生产接口类型重写两个 mock**

在 `AgentEngine.spec.ts` 导入 `ChatRequest`、`EngineChatFn`，把单个 nullable capture 改为数组：

```ts
import type { ChatChunk, ChatRequest } from '../model/types';
import type { EngineChatFn } from './AgentEngine';

const captured: ChatRequest[] = [];
const chat: EngineChatFn = async (req, opts) => {
  captured.push(req);
  opts.onChunk?.({ kind: 'delta', delta: 'ok' });
  opts.onChunk?.({ kind: 'done' });
  return { text: 'ok', usage: null };
};

// run 后
expect(captured).toHaveLength(1);
expect(captured[0].tools?.map((tool) => tool.name)).toEqual(['echo']);
```

在 `adapters.spec.ts` 为 mock 使用完整 fetch 输入联合类型，并用数组让控制流明确知道请求体已捕获：

```ts
interface OpenAIToolBody {
  tools?: Array<{ function: { name: string } }>;
}

const capturedBodies: OpenAIToolBody[] = [];
const fetchImpl: typeof fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
  capturedBodies.push(JSON.parse(String(init?.body)) as OpenAIToolBody);
  return mockFetch(['data: [DONE]'])();
};

// chat 后
expect(capturedBodies).toHaveLength(1);
expect(capturedBodies[0].tools?.[0]?.function.name).toBe('get_weather');
```

- [ ] **Step 3: 验证局部测试和全仓类型检查**

Run:

```bash
corepack pnpm --filter @jarvis/core exec vitest run src/agent/AgentEngine.spec.ts src/model/adapters/adapters.spec.ts
corepack pnpm typecheck
```

Expected: 两个 spec PASS；`pnpm typecheck` 退出码 0、无 TypeScript error。

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/agent/AgentEngine.spec.ts packages/core/src/model/adapters/adapters.spec.ts
git diff --cached --name-only
git diff --cached
git commit -m "test: restore TypeScript quality gate"
```

Expected staged files: 仅上述两个 spec。

---

### Task 2: 精确分类 SecureStorage 系统错误

**Files:**
- Modify: `apps/desktop/src/main/secrets/SecureStorage.spec.ts`
- Modify: `apps/desktop/src/main/secrets/SecureStorage.ts`

**Interfaces:**
- Produces: `CommandResult { stdout: string; stderr: string; exitCode: number }`
- Produces: `SecureStorageError extends Error { code: 'KEYCHAIN_READ_FAILED' | 'KEYCHAIN_WRITE_FAILED' | 'KEYCHAIN_DELETE_FAILED'; exitCode: number }`
- Maintains: `SecureStorage.get(key): Promise<string | null>`；只有 macOS `security` 明确 item-not-found 才返回 null。

- [ ] **Step 1: 写失败测试**

把测试注入结果补齐 `exitCode`，新增三类行为：

```ts
it('maps only an explicit macOS item-not-found to null', async () => {
  const store = new SecureStorage({
    platform: 'darwin',
    execImpl: async () => ({
      stdout: '',
      stderr: 'security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.',
      exitCode: 44,
    }),
  });
  await expect(store.get('missing')).resolves.toBeNull();
});

it.each([
  [36, 'User interaction is not allowed.'],
  [1, 'security command unavailable'],
])('surfaces keychain read failure code=%i', async (exitCode, stderr) => {
  const store = new SecureStorage({
    platform: 'darwin',
    execImpl: async () => ({ stdout: '', stderr, exitCode }),
  });
  await expect(store.get('provider.p1')).rejects.toMatchObject({
    name: 'SecureStorageError',
    code: 'KEYCHAIN_READ_FAILED',
    exitCode,
  });
});

it('redacts secrets from a thrown keychain error', async () => {
  const store = new SecureStorage({
    platform: 'darwin',
    execImpl: async () => ({ stdout: '', stderr: 'denied Bearer token-value sk-secret123', exitCode: 1 }),
  });
  await expect(store.get('provider.p1')).rejects.not.toThrow(/token-value|sk-secret123/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
corepack pnpm --dir apps/desktop exec vitest run --config vitest.config.ts src/main/secrets/SecureStorage.spec.ts
```

Expected: FAIL，因为 `execImpl` 尚无 `exitCode`，且现有 `get` 将所有 stderr 变成 null。

- [ ] **Step 3: 最小实现错误分类**

实现结果与错误类型：

```ts
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class SecureStorageError extends Error {
  constructor(
    public readonly code: 'KEYCHAIN_READ_FAILED' | 'KEYCHAIN_WRITE_FAILED' | 'KEYCHAIN_DELETE_FAILED',
    message: string,
    public readonly exitCode: number,
  ) {
    super(message);
    this.name = 'SecureStorageError';
  }
}

const ITEM_NOT_FOUND = /The specified item could not be found in the keychain/i;
```

默认执行器成功时返回 `exitCode: 0`；捕获 `execFile` 错误时保留数值 `code`，不能再把失败伪装成成功。`get` 使用：

```ts
if (result.exitCode === 0) return result.stdout.trim() || null;
if (result.exitCode === 44 && ITEM_NOT_FOUND.test(result.stderr)) return null;
throw new SecureStorageError(
  'KEYCHAIN_READ_FAILED',
  `keychain read failed: ${redactSecrets(result.stderr)}`,
  result.exitCode,
);
```

`set`/`delete` 对非零退出码分别抛 `KEYCHAIN_WRITE_FAILED`/`KEYCHAIN_DELETE_FAILED`；错误消息先调用 `redactSecrets`。

- [ ] **Step 4: 验证**

Run:

```bash
corepack pnpm --dir apps/desktop exec vitest run --config vitest.config.ts src/main/secrets/SecureStorage.spec.ts
corepack pnpm typecheck
```

Expected: SecureStorage spec PASS；typecheck 0 error。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/main/secrets/SecureStorage.ts apps/desktop/src/main/secrets/SecureStorage.spec.ts
git diff --cached --name-only
git diff --cached
git commit -m "fix(desktop): classify secure storage failures"
```

---

### Task 3: 收敛 IPC 常量并删除死路由

**Files:**
- Modify: `packages/protocol/src/ipc-channels.ts`
- Modify: `packages/protocol/src/ipc-allowlist.ts`
- Modify: `packages/protocol/src/ipc-allowlist.spec.ts`
- Modify: `packages/protocol/src/index.spec.ts`
- Modify: `apps/desktop/src/main/ipc/IpcRouter.ts`
- Modify: `apps/desktop/src/main/ipc/IpcRouter.spec.ts`
- Modify: `apps/desktop/src/main/ipc/register-agents-ipc.ts`
- Modify: `apps/desktop/src/main/ipc/register-coding-ipc.ts`
- Modify: `apps/desktop/src/main/ipc/register-safety-ipc.ts`
- Modify: `apps/desktop/src/main/ipc/runtime.ts`
- Modify: `apps/desktop/src/main/ipc/squad.ts`
- Modify: `apps/desktop/src/main/ipc/office.ts`
- Modify: `apps/desktop/src/renderer/src/pages/CodingPanelPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/DaemonManagementPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/AgentTemplatesPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/OfficePage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/PdfReaderPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/PromptTemplatesPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/SquadViewPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/AgentDetailPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/settings/ConcurrencySettingsPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/settings/EnvSettingsPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/settings/McpSettingsPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/settings/ProviderSettingsPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/settings/SkillsSettingsPage.tsx`
- Modify: `apps/desktop/src/renderer/src/components/agents/AgentTemplateView.tsx`
- Modify: `apps/desktop/src/renderer/src/components/canvas/CanvasView.tsx`
- Modify: `apps/desktop/src/renderer/src/components/coding/DiffPanel.tsx`
- Modify: `apps/desktop/src/renderer/src/components/coding/MentionPicker.tsx`
- Modify: `apps/desktop/src/renderer/src/components/logs/AuditLogView.tsx`
- Modify: `apps/desktop/src/renderer/src/components/office/DropZone.tsx`
- Modify: `apps/desktop/src/renderer/src/components/office/GlobalSearch.tsx`
- Modify: `apps/desktop/src/renderer/src/components/office/ImageGenerator.tsx`
- Modify: `apps/desktop/src/renderer/src/components/office/SelectionMenu.tsx`
- Modify: `apps/desktop/src/renderer/src/components/office/VideoSummary.tsx`
- Modify: `apps/desktop/src/renderer/src/components/office/WebViewSummary.tsx`
- Modify: `apps/desktop/src/renderer/src/components/office/WritingView.tsx`
- Modify: `apps/desktop/src/renderer/src/components/runtime/SkillsMerger.tsx`
- Modify: `apps/desktop/src/renderer/src/components/safety/BackupPane.tsx`
- Modify: `apps/desktop/src/renderer/src/components/safety/WipePane.tsx`
- Modify: `apps/desktop/src/renderer/src/components/settings/ConfigImportExportView.tsx`
- Modify: `apps/desktop/src/renderer/src/components/settings/ShortcutsSettingsView.tsx`
- Modify: `apps/desktop/src/renderer/src/components/squad/ApprovalPanel.tsx`
- Modify: `apps/desktop/src/renderer/src/components/squad/VersionHistoryPage.tsx`
- Modify: `apps/desktop/src/renderer/src/hooks/useShortcuts.ts`
- Modify: `apps/desktop/src/renderer/src/stores/runtime-store.ts`
- Modify: `apps/desktop/src/renderer/src/stores/usage-store.ts`
- Modify: `apps/desktop/src/renderer/src/stores/workflow-store.ts`
- Modify: `packages/core/src/agent/AgentEngine.ts:39-42`
- Delete: `apps/desktop/src/renderer/src/router.tsx`
- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel]`
- Produces: `type IpcEventName = (typeof IpcEvent)[keyof typeof IpcEvent]`
- Maintains: 现有 wire values，不重命名 channel。

- [ ] **Step 1: 写协议完整性失败测试**

在 `ipc-allowlist.spec.ts` 增加：

```ts
it('derives the renderer invoke allowlist only from protocol constants', () => {
  const channelValues = new Set(Object.values(IpcChannel));
  for (const channel of ALLOWED_INVOKE) expect(channelValues.has(channel as never)).toBe(true);
});

it('contains every public event constant in the event allowlist', () => {
  expect([...ALLOWED_EVENTS].sort()).toEqual(Object.values(IpcEvent).sort());
});
```

Expected: 第一项 FAIL，因为 allowlist 中仍有大量值不在 `IpcChannel`。

- [ ] **Step 2: 补齐唯一 channel 表**

在 `IpcChannel` 中逐项加入现有 wire value：

```ts
shortcutsGet: 'shortcuts.get',
shortcutsSet: 'shortcuts.set',
agentTemplatesList: 'agent-templates.list',
agentTemplatesCreateAgent: 'agent-templates.createAgent',
mcpList: 'mcp.list',
mcpCreate: 'mcp.create',
mcpDelete: 'mcp.delete',
mcpTest: 'mcp.test',
skillsList: 'skills.list',
skillsImport: 'skills.import',
skillsDelete: 'skills.delete',
workspaceBind: 'workspace.bind',
workspaceListBound: 'workspace.listBound',
workspaceLoadContext: 'workspace.loadContext',
workspaceCopyFiles: 'workspace.copyFiles',
indexSearch: 'index.search',
mentionSearch: 'mention.search',
dialogSaveText: 'dialog.saveText',
configReadPickedFile: 'config.readPickedFile',
providerListModels: 'provider.listModels',
providerAddModel: 'provider.addModel',
providerTest: 'provider.test',
usageSummary: 'usage.summary',
usageList: 'usage.list',
auditList: 'audit.list',
auditExport: 'audit.export',
artifactsList: 'artifacts.list',
artifactsSave: 'artifacts.save',
backupList: 'backup.list',
backupCreate: 'backup.create',
backupRestore: 'backup.restore',
appRelaunch: 'app.relaunch',
wipeRun: 'wipe.run',
squadCreate: 'squad.create',
squadGraph: 'squad.graph',
squadApprove: 'squad.approve',
workflowRun: 'workflow.run',
proxyGet: 'proxy.get',
proxySet: 'proxy.set',
configExport: 'config.export',
configImport: 'config.import',
exportSession: 'export.session',
templatesList: 'templates.list',
templatesCreate: 'templates.create',
templatesUpdate: 'templates.update',
templatesDelete: 'templates.delete',
templatesRender: 'templates.render',
searchGlobal: 'search.global',
runtimeStatus: 'runtime.status',
runtimeConflicts: 'runtime.conflicts',
runtimeResolveConflict: 'runtime.resolveConflict',
officeSelection: 'office.selection',
officeWriting: 'office.writing',
officeWritingTranslate: 'office.writing.translate',
officePdfExtract: 'office.pdf.extract',
officePdfSummarize: 'office.pdf.summarize',
officeWebviewOpen: 'office.webview.open',
officeWebviewSummarize: 'office.webview.summarize',
officeVideoSummarize: 'office.video.summarize',
officeImageGenerate: 'office.image.generate',
officeFileAnalyze: 'office.file.analyze',
```

导出两个 union type；`ALLOWED_INVOKE` 改成 `new Set<IpcChannelName>([IpcChannel...])`，不保留任何裸字符串。

- [ ] **Step 3: 迁移 main 与 renderer 调用点**

所有列出的 main/renderer 文件从 `@jarvis/protocol` 导入 `IpcChannel`，将 `invoke('x.y')`、`register('x.y')`、`handlers.get('x.y')` 替换为对应属性。负向测试允许保留 `'secrets.get'`、`'fs.readFile'`、`'unknown.channel'`，因为它们验证拒绝行为；注释中的调用示例也改为 `IpcChannel.*` 或描述性文字。

Run:

```bash
rg "window\.jarvis\.(invoke|onDidReceive)\(['\"]" apps/desktop/src/renderer/src
rg "this\.register\(['\"]|handlers\.get\(['\"]" apps/desktop/src/main
rg "^[[:space:]]*['\"][a-z][^'\"]*[.:][^'\"]*['\"]," packages/protocol/src/ipc-allowlist.ts
```

Expected: 三条命令均无输出；负向测试不在这些生产路径匹配范围。

- [ ] **Step 4: 删除死路由与依赖**

```bash
rm apps/desktop/src/renderer/src/router.tsx
corepack pnpm --dir apps/desktop remove @tanstack/react-router
```

Expected: `apps/desktop/package.json` 不再含 `@tanstack/react-router`，lockfile 不再含其 importer。

- [ ] **Step 5: 同步 DOC-01 注释**

把 `AgentEngine.ts` 旧的“ChatRequest 没有 tools”注释替换为当前不变量：

```ts
// Plan mode limits the tool definitions sent to the model. Execution-side
// approval remains the second gate, so a hidden or denied write tool cannot
// execute even if a provider returns an unexpected tool call.
```

- [ ] **Step 6: 验证**

Run:

```bash
corepack pnpm --filter @jarvis/protocol test
corepack pnpm --dir apps/desktop exec vitest run --config vitest.config.ts src/main/ipc/IpcRouter.spec.ts
corepack pnpm typecheck
corepack pnpm audit --prod --audit-level high
```

Expected: protocol/IpcRouter PASS，typecheck 0 error；audit 中 TanStack Router 不再出现。若 audit 仍因已知 `xlsx` 高危退出非零，记录该唯一阻断并由 Office plan 移除后复跑，不把本 Task 标为全仓 audit 通过。

- [ ] **Step 7: 提交**

```bash
git add -- \
  packages/protocol/src/ipc-channels.ts \
  packages/protocol/src/ipc-allowlist.ts \
  packages/protocol/src/ipc-allowlist.spec.ts \
  packages/protocol/src/index.spec.ts \
  apps/desktop/src/main/ipc/IpcRouter.ts \
  apps/desktop/src/main/ipc/IpcRouter.spec.ts \
  apps/desktop/src/main/ipc/register-agents-ipc.ts \
  apps/desktop/src/main/ipc/register-coding-ipc.ts \
  apps/desktop/src/main/ipc/register-safety-ipc.ts \
  apps/desktop/src/main/ipc/runtime.ts \
  apps/desktop/src/main/ipc/squad.ts \
  apps/desktop/src/main/ipc/office.ts \
  apps/desktop/src/renderer/src/pages/CodingPanelPage.tsx \
  apps/desktop/src/renderer/src/pages/DaemonManagementPage.tsx \
  apps/desktop/src/renderer/src/pages/AgentTemplatesPage.tsx \
  apps/desktop/src/renderer/src/pages/OfficePage.tsx \
  apps/desktop/src/renderer/src/pages/PdfReaderPage.tsx \
  apps/desktop/src/renderer/src/pages/PromptTemplatesPage.tsx \
  apps/desktop/src/renderer/src/pages/SquadViewPage.tsx \
  apps/desktop/src/renderer/src/pages/AgentDetailPage.tsx \
  apps/desktop/src/renderer/src/pages/settings/ConcurrencySettingsPage.tsx \
  apps/desktop/src/renderer/src/pages/settings/EnvSettingsPage.tsx \
  apps/desktop/src/renderer/src/pages/settings/McpSettingsPage.tsx \
  apps/desktop/src/renderer/src/pages/settings/ProviderSettingsPage.tsx \
  apps/desktop/src/renderer/src/pages/settings/SkillsSettingsPage.tsx \
  apps/desktop/src/renderer/src/components/agents/AgentTemplateView.tsx \
  apps/desktop/src/renderer/src/components/canvas/CanvasView.tsx \
  apps/desktop/src/renderer/src/components/coding/DiffPanel.tsx \
  apps/desktop/src/renderer/src/components/coding/MentionPicker.tsx \
  apps/desktop/src/renderer/src/components/logs/AuditLogView.tsx \
  apps/desktop/src/renderer/src/components/office/DropZone.tsx \
  apps/desktop/src/renderer/src/components/office/GlobalSearch.tsx \
  apps/desktop/src/renderer/src/components/office/ImageGenerator.tsx \
  apps/desktop/src/renderer/src/components/office/SelectionMenu.tsx \
  apps/desktop/src/renderer/src/components/office/VideoSummary.tsx \
  apps/desktop/src/renderer/src/components/office/WebViewSummary.tsx \
  apps/desktop/src/renderer/src/components/office/WritingView.tsx \
  apps/desktop/src/renderer/src/components/runtime/SkillsMerger.tsx \
  apps/desktop/src/renderer/src/components/safety/BackupPane.tsx \
  apps/desktop/src/renderer/src/components/safety/WipePane.tsx \
  apps/desktop/src/renderer/src/components/settings/ConfigImportExportView.tsx \
  apps/desktop/src/renderer/src/components/settings/ShortcutsSettingsView.tsx \
  apps/desktop/src/renderer/src/components/squad/ApprovalPanel.tsx \
  apps/desktop/src/renderer/src/components/squad/VersionHistoryPage.tsx \
  apps/desktop/src/renderer/src/hooks/useShortcuts.ts \
  apps/desktop/src/renderer/src/stores/runtime-store.ts \
  apps/desktop/src/renderer/src/stores/usage-store.ts \
  apps/desktop/src/renderer/src/stores/workflow-store.ts \
  packages/core/src/agent/AgentEngine.ts \
  apps/desktop/package.json \
  pnpm-lock.yaml
git add -u apps/desktop/src/renderer/src/router.tsx
git diff --cached --name-only
git diff --cached
git commit -m "refactor: centralize IPC channel constants"
```

Expected: staged diff 不包含本 Task 文件表之外的用户改动。

---

### Task 4: 建立 lint、format 与依赖安全基线

**Files:**
- Create: `eslint.config.mjs`
- Create: `.prettierrc.json`
- Create: `.prettierignore`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Format: `apps/desktop/**/*.{ts,tsx,json}`
- Format: `packages/**/*.{ts,tsx,json}`
- Format: `scripts/**/*.{js,mjs,ts}`
- Format: `*.{json,md,yaml,yml}`

**Interfaces:**
- Produces scripts: `lint`、`format`、`format:check`。
- Dependency pins: ESLint 9.39.5、`@eslint/js` 9.39.5、typescript-eslint 8.66.0、React Hooks 7.1.1、React Refresh 0.5.3、eslint-plugin-security 4.0.1、globals 17.9.0、Prettier 3.9.6。

- [ ] **Step 1: 依赖安全硬门禁**

执行 `/check-dependency` 的 Sonatype MCP 等价查询，PURL 必须是：

```text
pkg:npm/eslint@9.39.5
pkg:npm/%40eslint/js@9.39.5
pkg:npm/typescript-eslint@8.66.0
pkg:npm/eslint-plugin-react-hooks@7.1.1
pkg:npm/eslint-plugin-react-refresh@0.5.3
pkg:npm/eslint-plugin-security@4.0.1
pkg:npm/globals@17.9.0
pkg:npm/prettier@3.9.6
pkg:npm/%40vitest/coverage-v8@2.1.9
```

Acceptance:

- 0 critical/high vulnerability；
- MIT 或 Apache-2.0；
- Developer Trust Score ≥80；
- Node engine 兼容 `>=20.11.0`；
- peer range 接受 ESLint 9 / TypeScript 5.9 / Vitest 2.1.9。

规划时 Sonatype 在认证成功后仍返回 `Authentication required`，因此不得伪造评分；执行本 Task 时该检查必须返回实际结果。若任一包不满足，使用 `getRecommendedComponentVersions` 返回的最高 Trust Score、无 high/critical、兼容 Node 20.11 的同 major 版本替换，并把实际 PURL 记录在提交正文。Registry 已确认上述包均为 MIT/Apache-2.0，ESLint 9 支持 Node `^20.9.0`，coverage-v8 2.1.9 与 Vitest 2.1.9 精确 peer 匹配。

- [ ] **Step 2: 精确安装开发依赖**

```bash
corepack pnpm add -Dw -E eslint@9.39.5 @eslint/js@9.39.5 typescript-eslint@8.66.0 eslint-plugin-react-hooks@7.1.1 eslint-plugin-react-refresh@0.5.3 eslint-plugin-security@4.0.1 globals@17.9.0 prettier@3.9.6 @vitest/coverage-v8@2.1.9
corepack pnpm audit --audit-level high
```

Expected: lockfile 固定上述版本；新增工具链不引入 critical/high。现有生产 `xlsx` 风险单独由 Office plan 处理，不能用 `--audit-level critical` 降低门禁。

- [ ] **Step 3: 创建 ESLint flat config**

`eslint.config.mjs` 内容：

```js
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import security from 'eslint-plugin-security';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/coverage/**',
      '**/.turbo/**',
      'wiki/**',
      'apps/desktop/resources/daemon/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      security,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'security/detect-eval-with-expression': 'error',
      'security/detect-child-process': 'warn',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{ name: '@jarvis/core', message: 'Renderer must import @jarvis/core/renderer.' }],
        patterns: ['node:*', 'electron', 'better-sqlite3'],
      }],
    },
  },
  {
    files: ['**/*.spec.{ts,tsx}', 'apps/desktop/e2e/**/*.ts'],
    rules: {
      'security/detect-child-process': 'off',
      'react-refresh/only-export-components': 'off',
    },
  },
);
```

- [ ] **Step 4: 创建 Prettier 配置并格式化一次**

`.prettierrc.json`：

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "semi": true,
  "printWidth": 120
}
```

`.prettierignore`：

```text
node_modules
dist
out
coverage
.turbo
wiki
apps/desktop/resources/daemon
pnpm-lock.yaml
```

根 scripts：

```json
"lint": "eslint . --max-warnings=0",
"format": "prettier --write \"apps/desktop/**/*.{ts,tsx,json}\" \"packages/**/*.{ts,tsx,json}\" \"scripts/**/*.{js,mjs,ts}\" \"*.{json,md,yaml,yml}\"",
"format:check": "prettier --check \"apps/desktop/**/*.{ts,tsx,json}\" \"packages/**/*.{ts,tsx,json}\" \"scripts/**/*.{js,mjs,ts}\" \"*.{json,md,yaml,yml}\""
```

Run:

```bash
corepack pnpm format
corepack pnpm lint
corepack pnpm format:check
corepack pnpm typecheck
```

Expected: lint 0 errors/0 warnings；format check 显示 `All matched files use Prettier code style!`；typecheck 0 error。

- [ ] **Step 5: 提交**

此机械格式化 Task 仅在前置 plans/Tasks 已提交、tracked worktree 干净时执行；先运行 `git status --short`，若仍有既有 tracked 修改则停止，不得把它们混入格式化提交。格式化命令的四个 glob 就是本 Task 的完整文件集合。

```bash
git status --short
git add -- eslint.config.mjs .prettierrc.json .prettierignore package.json pnpm-lock.yaml
git add -- 'apps/desktop/**/*.ts' 'apps/desktop/**/*.tsx' 'apps/desktop/**/*.json'
git add -- 'packages/**/*.ts' 'packages/**/*.tsx' 'packages/**/*.json'
git add -- 'scripts/**/*.js' 'scripts/**/*.mjs' 'scripts/**/*.ts'
git add -- '*.json' '*.md' '*.yaml' '*.yml'
git diff --cached --name-only
git diff --cached
git commit -m "chore: add static quality tooling"
```

提交前从 staged diff 移除任何与机械格式化无关的既有用户修改；此 Task 允许的生产 diff 只能是 Prettier 机械格式。

---

### Task 5: 拆分 main 与 renderer Vitest projects

**Files:**
- Create: `apps/desktop/vitest.main.config.ts`
- Create: `apps/desktop/vitest.renderer.config.ts`
- Create: `apps/desktop/vitest.workspace.ts`
- Delete: `apps/desktop/vitest.config.ts`
- Modify: `apps/desktop/vitest.setup.ts`
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/src/main/secrets/SecureStorage.spec.ts`
- Modify: `apps/desktop/src/renderer/src/stores/settings-store.spec.ts`

**Interfaces:**
- Produces project `main`：`environment: 'node'`，只收集 `src/main/**/*.spec.ts`。
- Produces project `renderer`：`environment: 'jsdom'`，只收集 `src/renderer/**/*.spec.{ts,tsx}`。

- [ ] **Step 1: 写环境断言**

新增到 `SecureStorage.spec.ts`：

```ts
it('runs main specs in the Node project', () => {
  expect(typeof window).toBe('undefined');
  expect(typeof document).toBe('undefined');
});
```

新增到 `settings-store.spec.ts`：

```ts
it('runs renderer specs in jsdom', () => {
  expect(window.document).toBe(document);
});
```

Run:

```bash
corepack pnpm --dir apps/desktop exec vitest run
```

Expected: main 环境断言 FAIL，因为当前全局环境是 jsdom。

- [ ] **Step 2: 创建 project 配置**

`vitest.main.config.ts`：

```ts
import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'main',
    environment: 'node',
    include: ['src/main/**/*.spec.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'out/**', 'dist/**'],
  },
});
```

`vitest.renderer.config.ts`：

```ts
import react from '@vitejs/plugin-react';
import { defineProject } from 'vitest/config';

export default defineProject({
  plugins: [react()],
  test: {
    name: 'renderer',
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/renderer/**/*.spec.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'out/**', 'dist/**'],
  },
});
```

`vitest.workspace.ts`：

```ts
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  './vitest.main.config.ts',
  './vitest.renderer.config.ts',
]);
```

删除旧的单环境 `vitest.config.ts`；`vitest.setup.ts` 删除“也服务 Node main specs”的过时注释，明确其仅属于 renderer project。

- [ ] **Step 3: 更新 Desktop scripts**

```json
"test": "vitest run --workspace vitest.workspace.ts",
"test:main": "vitest run --config vitest.main.config.ts",
"test:renderer": "vitest run --config vitest.renderer.config.ts"
```

- [ ] **Step 4: 验证独立执行**

```bash
corepack pnpm --dir apps/desktop test:main
corepack pnpm --dir apps/desktop test:renderer
corepack pnpm --dir apps/desktop test
```

Expected: main 输出 `[main]` 且无 jsdom；renderer 输出 `[renderer]` 且 ResizeObserver setup 生效；组合执行所有 Desktop Vitest specs，不收集 `e2e/**`。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/vitest.main.config.ts apps/desktop/vitest.renderer.config.ts apps/desktop/vitest.workspace.ts apps/desktop/vitest.setup.ts apps/desktop/package.json apps/desktop/src/main/secrets/SecureStorage.spec.ts apps/desktop/src/renderer/src/stores/settings-store.spec.ts
git add -u apps/desktop/vitest.config.ts
git diff --cached --name-only
git diff --cached
git commit -m "test(desktop): isolate Vitest runtime projects"
```

---

### Task 6: 达到三域覆盖率阈值

**Files:**
- Create: `packages/core/vitest.config.ts`
- Modify: `packages/core/package.json`
- Modify: `apps/desktop/vitest.main.config.ts`
- Modify: `apps/desktop/vitest.renderer.config.ts`
- Modify: `apps/desktop/package.json`
- Modify: `package.json`
- Modify: `turbo.json`
- Create: `apps/desktop/src/renderer/src/stores/provider-store.spec.ts`
- Create: `apps/desktop/src/renderer/src/stores/taskboard-store.spec.ts`
- Create: `apps/desktop/src/renderer/src/stores/squad-store.spec.ts`
- Create: `apps/desktop/src/renderer/src/stores/init-store.spec.ts`
- Create: `apps/desktop/src/renderer/src/stores/ipc-subscriptions.spec.ts`
- Create: `apps/desktop/src/renderer/src/stores/usage-store.spec.ts`
- Modify: `packages/core/src/task/TaskOrchestrator.spec.ts`
- Modify: `apps/desktop/src/main/secrets/SecureStorage.spec.ts`
- Modify: `apps/desktop/src/main/ipc/IpcRouter.spec.ts`
- Modify: `apps/desktop/src/main/window/WindowManager.spec.ts`

**Interfaces:**
- Produces: core coverage `85 lines / 80 branches`。
- Produces: main coverage `80 lines / 75 branches`。
- Produces: renderer stores coverage `90 lines / 85 branches`。

- [ ] **Step 1: 配置覆盖域与失败阈值**

Core config：

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage/core',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts', 'src/renderer.ts', 'src/**/*.d.ts'],
      thresholds: { lines: 85, branches: 80 },
    },
  },
});
```

Main project coverage：

```ts
coverage: {
  provider: 'v8',
  reporter: ['text', 'json-summary', 'html'],
  reportsDirectory: 'coverage/main',
  include: ['src/main/**/*.ts'],
  exclude: ['src/main/**/*.spec.ts', 'src/main/index.ts', 'src/main/mammoth.d.ts'],
  thresholds: { lines: 80, branches: 75 },
},
```

Renderer project coverage：

```ts
coverage: {
  provider: 'v8',
  reporter: ['text', 'json-summary', 'html'],
  reportsDirectory: 'coverage/renderer-stores',
  include: ['src/renderer/src/stores/**/*.ts'],
  exclude: ['src/renderer/src/stores/**/*.spec.ts'],
  thresholds: { lines: 90, branches: 85 },
},
```

Scripts：

```json
// packages/core
"coverage": "vitest run --coverage"

// apps/desktop
"coverage:main": "vitest run --config vitest.main.config.ts --coverage",
"coverage:renderer": "vitest run --config vitest.renderer.config.ts --coverage",
"coverage": "pnpm coverage:main && pnpm coverage:renderer"

// root
"coverage": "turbo run coverage"
```

Turbo：

```json
"coverage": { "dependsOn": ["build"], "outputs": ["coverage/**"] }
```

- [ ] **Step 2: 首次运行确认缺口**

```bash
corepack pnpm coverage
```

Expected: FAIL 至少在 renderer stores 阈值；报告明确列出 provider/taskboard/squad/init/ipc-subscriptions/usage 未覆盖分支，不接受通过降低阈值解决。

- [ ] **Step 3: 补 renderer store 行为测试**

每个新 spec 必须在 `beforeEach` 重置 Zustand state 和 `window.jarvis` mock，并覆盖：

- `provider-store.spec.ts`：refresh 成功/失败 loading 复位，create 追加，remove 删除。
- `taskboard-store.spec.ts`：load 分组六种状态，cancel/pause/resume/retry 调用对应 `IpcChannel` 后 reload。
- `squad-store.spec.ts`：start 的 `in_review` 与非 review 分支；200 条 event 上限；subscribe/unsubscribe/clear。
- `init-store.spec.ts`：zh-CN 默认、已有 language 切换、onboarding boolean、重复初始化只安装一次订阅。
- `ipc-subscriptions.spec.ts`：重复调用幂等；active task 过滤；chat session 过滤；complete/failed/state、approval 去重、squad event/status、toast。
- `usage-store.spec.ts`：成功更新；失败保留 last-known summary 且记录脱敏 console error。

测试必须按实际 channel 常量断言，例如：

```ts
expect(invoke).toHaveBeenCalledWith(IpcChannel.usageSummary);
expect(useUsageStore.getState().summary).toEqual(summary);
```

- [ ] **Step 4: 补齐 main/core 的指定边界分支**

不得用 coverage ignore、扩大 exclude 或降低阈值。精确补充：

- `TaskOrchestrator.spec.ts`：queued cancel 不进入 engine；running cancel 不被 AbortError 覆盖为 failed；retry 只接受 failed/cancelled/completed；每 Agent 并发上限；`finally` 释放 active slot。
- `SecureStorage.spec.ts`：macOS set/delete 非零退出码；非 macOS 缺 encrypt/decrypt；encrypted file 不存在；decrypt 异常透传。
- `IpcRouter.spec.ts`：`listen()` 为每个 map entry 注册一次；`dispose()` 幂等清空；template update/render/search 的 catch 分支返回 `{ ok:false,error }`。
- `WindowManager.spec.ts`：允许应用自身 origin；拒绝 remote `will-navigate`/`will-frame-navigate`；HTTPS 只交给 `shell.openExternal`；非 HTTP(S) URL 拒绝。

Run:

```bash
corepack pnpm --filter @jarvis/core exec vitest run src/task/TaskOrchestrator.spec.ts
corepack pnpm --dir apps/desktop test:main
```

Expected: 所有新增边界测试 PASS。

- [ ] **Step 5: 验证阈值**

```bash
corepack pnpm coverage
node -e "for (const p of ['packages/core/coverage/core/coverage-summary.json','apps/desktop/coverage/main/coverage-summary.json','apps/desktop/coverage/renderer-stores/coverage-summary.json']) { const s=require('./'+p).total; console.log(p,s.lines.pct,s.branches.pct) }"
```

Expected:

```text
core lines >= 85, branches >= 80
main lines >= 80, branches >= 75
renderer-stores lines >= 90, branches >= 85
```

- [ ] **Step 6: 提交**

```bash
git add -- \
  packages/core/vitest.config.ts \
  packages/core/package.json \
  packages/core/src/task/TaskOrchestrator.spec.ts \
  apps/desktop/vitest.main.config.ts \
  apps/desktop/vitest.renderer.config.ts \
  apps/desktop/package.json \
  apps/desktop/src/main/secrets/SecureStorage.spec.ts \
  apps/desktop/src/main/ipc/IpcRouter.spec.ts \
  apps/desktop/src/main/window/WindowManager.spec.ts \
  apps/desktop/src/renderer/src/stores/provider-store.spec.ts \
  apps/desktop/src/renderer/src/stores/taskboard-store.spec.ts \
  apps/desktop/src/renderer/src/stores/squad-store.spec.ts \
  apps/desktop/src/renderer/src/stores/init-store.spec.ts \
  apps/desktop/src/renderer/src/stores/ipc-subscriptions.spec.ts \
  apps/desktop/src/renderer/src/stores/usage-store.spec.ts \
  package.json \
  turbo.json
git diff --cached --name-only
git diff --cached
git commit -m "test: enforce coverage thresholds"
```

---

### Task 7: 让 Node 与 Electron ABI 入口顺序无关

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/README.md`
- Modify: `package.json`

**Interfaces:**
- Produces: `test:node` 在每次 unit/coverage 前主动恢复 Node ABI。
- Produces: `e2e:electron:ci` 在 E2E 前主动构建并恢复 Electron ABI。

- [ ] **Step 1: 复现 ABI 污染**

```bash
corepack pnpm --dir apps/desktop rebuild:electron
corepack pnpm --dir apps/desktop test:main
```

Expected: FAIL，报 `NODE_MODULE_VERSION 128` 与当前 Node ABI 不匹配。

- [ ] **Step 2: 让每个入口自包含**

Desktop scripts：

```json
"test:node": "pnpm rebuild:node && pnpm test",
"coverage:node": "pnpm rebuild:node && pnpm coverage",
"e2e:electron:ci": "electron-vite build && pnpm rebuild:electron && playwright test",
"rebuild:electron": "electron-rebuild -f -w better-sqlite3",
"rebuild:node": "pnpm rebuild better-sqlite3"
```

根 scripts：

```json
"test:unit": "pnpm --dir apps/desktop rebuild:node && turbo run test",
"test": "pnpm test:unit",
"coverage": "pnpm --dir apps/desktop rebuild:node && turbo run coverage"
```

README 明确：任何 Node 入口会自修复 Node ABI，任何 Electron CI 入口会自修复 Electron ABI；CI 仍必须分 job，不能把同一 checkout 的 `node_modules` 当跨 ABI artifact 上传。

- [ ] **Step 3: 双向验证**

```bash
corepack pnpm --dir apps/desktop rebuild:electron
corepack pnpm test
corepack pnpm --dir apps/desktop rebuild:node
corepack pnpm --dir apps/desktop e2e:electron:ci -- --list
corepack pnpm test
```

Expected: 第一次 root unit 自动恢复 Node ABI 并 PASS；E2E list/build 自动恢复 Electron ABI；最后 unit 再次自动恢复 Node ABI 并 PASS。

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/package.json apps/desktop/README.md package.json
git diff --cached --name-only
git diff --cached
git commit -m "test(desktop): isolate native module ABI entrypoints"
```

---

### Task 8: 将 Playwright 与配置纳入 TypeScript 门禁

**Files:**
- Create: `apps/desktop/tsconfig.config.json`
- Create: `apps/desktop/tsconfig.e2e.json`
- Modify: `apps/desktop/tsconfig.json`
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/playwright.config.ts`
- Modify: `apps/desktop/e2e/global-setup.ts`

**Interfaces:**
- Produces: `typecheck:app`、`typecheck:config`、`typecheck:e2e`。
- Playwright `webServer` 位于顶层，renderer/electron projects 共用。

- [ ] **Step 1: 创建独立 tsconfig**

`tsconfig.config.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"]
  },
  "include": [
    "electron.vite.config.ts",
    "vite.e2e.config.ts",
    "vitest.config.ts",
    "vitest.main.config.ts",
    "vitest.renderer.config.ts",
    "vitest.workspace.ts",
    "playwright.config.ts"
  ]
}
```

`tsconfig.e2e.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node", "@playwright/test"]
  },
  "include": ["e2e/**/*.ts"]
}
```

Desktop scripts：

```json
"typecheck:app": "tsc --noEmit -p tsconfig.json",
"typecheck:config": "tsc --noEmit -p tsconfig.config.json",
"typecheck:e2e": "tsc --noEmit -p tsconfig.e2e.json",
"typecheck": "pnpm typecheck:app && pnpm typecheck:config && pnpm typecheck:e2e"
```

- [ ] **Step 2: 运行并确认 Playwright schema 失败**

```bash
corepack pnpm --dir apps/desktop typecheck
```

Expected: FAIL，指出 project 内 `webServer` 不属于当前 `Project` 类型。

- [ ] **Step 3: 修复 Playwright config**

将 `webServer: rendererServer` 移到 `defineConfig` 顶层，只保留 project-specific `testMatch`/`use`。增加失败证据配置：

```ts
reporter: process.env.CI
  ? [['line'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
  : 'list',
outputDir: 'test-results',
use: {
  trace: 'retain-on-failure',
  screenshot: 'only-on-failure',
  video: 'retain-on-failure',
},
webServer: rendererServer,
```

`global-setup.ts` 删除 Electron rebuild；ABI 只由 `e2e:electron:ci` 入口控制，避免 Playwright config 加载阶段隐式改写 `node_modules`。

- [ ] **Step 4: 验证**

```bash
corepack pnpm --dir apps/desktop typecheck
corepack pnpm --dir apps/desktop exec playwright test --list
```

Expected: 三个 tsconfig 均 0 error；Playwright 列出 renderer 与 electron specs，无 config schema error。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/tsconfig.json apps/desktop/tsconfig.config.json apps/desktop/tsconfig.e2e.json apps/desktop/package.json apps/desktop/playwright.config.ts apps/desktop/e2e/global-setup.ts
git diff --cached --name-only
git diff --cached
git commit -m "test(desktop): typecheck Playwright configuration"
```

---

### Task 9: 用真实 mock Provider 完成 S2 Electron E2E

**Files:**
- Create: `apps/desktop/e2e/helpers/mock-provider.ts`
- Modify: `apps/desktop/e2e/s2-file-shell.spec.ts`
- Modify: `apps/desktop/playwright.config.ts`

**Interfaces:**
- Produces: `startMockProvider(): Promise<{ baseUrl: string; requests: OpenAIRequest[]; close(): Promise<void> }>`
- Mock 只监听 `127.0.0.1` 随机端口，只接受 `POST /v1/chat/completions`。

- [ ] **Step 1: 写真实旅程测试并确认占位不再可通过**

删除 `expect(true).toBe(true)`。新测试必须：

1. 创建隔离 data dir 和 workspace；
2. 仅为该 E2E Electron 子进程设置 `JARVIS_ALLOW_LOOPBACK_URLS=1` 并启动真实 Electron；另有 main 单测证明未设置该变量时 loopback Provider 仍被拒绝；
3. 通过 preload IPC 创建 Provider、model、agent；
4. 保存 agent 的 `permissions.<id>`，只允许 `ls`；
5. 从真实聊天输入发送任务；
6. 分别批准 `write_file` 与 `run_shell`；
7. 等待 `task:complete`；
8. 断言文件内容、第二轮 Provider 请求中的两个 tool result、Shell 输出和任务 completed。

在 mock helper 尚不存在时运行：

```bash
corepack pnpm --dir apps/desktop exec playwright test --project=electron e2e/s2-file-shell.spec.ts
```

Expected: FAIL，提示无法导入 `./helpers/mock-provider`；不再存在恒真通过。

- [ ] **Step 2: 实现 loopback SSE mock**

核心实现：

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export interface OpenAIRequest {
  model: string;
  messages: Array<Record<string, unknown>>;
}

export async function startMockProvider() {
  const requests: OpenAIRequest[] = [];
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as OpenAIRequest);
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    if (requests.length === 1) {
      res.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_write","function":{"name":"write_file","arguments":"{\\"path\\":\\"hello.txt\\",\\"content\\":\\"hello jarvis\\"}"}},{"index":1,"id":"call_ls","function":{"name":"run_shell","arguments":"{\\"command\\":\\"ls\\"}"}}]}}]}\n\n');
    } else {
      res.write('data: {"choices":[{"delta":{"content":"S2 completed"}}]}\n\n');
    }
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('mock provider did not bind a TCP port');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
```

- [ ] **Step 3: 实现 S2 断言**

测试使用 `IpcChannel`/`IpcEvent`，不使用 channel 裸字符串。关键 setup：

```ts
const provider = await window.evaluate(
  ({ baseUrl, channel }) => window.jarvis.invoke(channel, {
    name: 'Local E2E Provider',
    type: 'openai-compatible',
    baseUrl,
    apiKey: 'sk-e2e-local-only',
  }),
  { baseUrl: mock.baseUrl, channel: IpcChannel.providerCreate },
) as { id: string };

const model = await window.evaluate(
  ({ channel, providerId }) => window.jarvis.invoke(channel, providerId, {
    modelId: 'e2e-model',
    name: 'E2E Model',
  }),
  { channel: IpcChannel.providerAddModel, providerId: provider.id },
) as { id: string };
```

Agent `workspaceId` 指向测试临时 workspace，随后 `settingsSet('permissions.<agentId>', { level: 'readwrite', allowCommands: ['ls'], allowDomains: [] })`。发送后依次等待 `approval-tool` 为 `write_file`、`run_shell` 并点击 `approval-approve`。

创建 Agent 后调用 `window.reload()`，等待 `agent-switcher` 出现并确认 `agent-e2e-s2-agent` 可见，使 renderer store 选择真实新 Agent 后再填写 `chat-input` 与点击 `chat-send`。

终态断言：

```ts
await expect(window.getByText('S2 completed')).toBeVisible();
expect(readFileSync(join(workspace, 'hello.txt'), 'utf8')).toBe('hello jarvis');
expect(mock.requests).toHaveLength(2);
expect(JSON.stringify(mock.requests[1].messages)).toContain('call_write');
expect(JSON.stringify(mock.requests[1].messages)).toContain('call_ls');
expect(JSON.stringify(mock.requests[1].messages)).toContain('hello.txt');
```

`finally` 必须关闭 Electron、mock server，并删除 data/workspace 临时目录。

Playwright electron project 的 `testMatch` 加入 `s2-file-shell.spec.ts`；renderer project 移除该文件，避免同一 S2 被 mock bridge 假执行。

- [ ] **Step 4: 验证**

```bash
corepack pnpm --dir apps/desktop e2e:electron:ci -- --project=electron e2e/s2-file-shell.spec.ts
```

Expected: PASS 1；Provider 收到两轮真实 HTTP；Electron main/preload/SQLite/SecureStorage/AgentEngine/file/Shell/task event 全链路参与。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/e2e/helpers/mock-provider.ts apps/desktop/e2e/s2-file-shell.spec.ts apps/desktop/playwright.config.ts
git diff --cached --name-only
git diff --cached
git commit -m "test(desktop): cover real S2 Electron journey"
```

---

### Task 10: 建立 PR CI 与统一 test:all

**Files:**
- Create: `.github/workflows/pr-quality.yml`
- Modify: `package.json`
- Modify: `turbo.json`

**Interfaces:**
- Produces root script `test:go`、`test:e2e`、`test:all`。
- Produces required jobs: `static-quality`、`node-unit-coverage`、`go-race`、`electron-e2e`。

- [ ] **Step 1: 定义统一脚本**

Root scripts：

```json
"test:go": "cd daemon && go test ./... && go test -race ./...",
"test:e2e": "pnpm --dir apps/desktop e2e:electron:ci",
"test:all": "pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm coverage && pnpm test:go && pnpm i18n:check && pnpm build && pnpm test:e2e && pnpm audit --prod --audit-level high"
```

Turbo 保持：

```json
"lint": { "dependsOn": ["^build"] },
"test": { "dependsOn": ["build"] },
"coverage": { "dependsOn": ["build"], "outputs": ["coverage/**"] },
"typecheck": { "dependsOn": ["^build"] }
```

- [ ] **Step 2: 创建 GitHub Actions workflow**

`.github/workflows/pr-quality.yml`：

```yaml
name: PR Quality

on:
  pull_request:
  push:
    branches: [master]

permissions:
  contents: read

concurrency:
  group: pr-quality-${{ github.ref }}
  cancel-in-progress: true

env:
  CI: true
  NODE_VERSION: 20.11.1
  PNPM_VERSION: 9.12.0

jobs:
  static-quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
      - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4
        with:
          version: ${{ env.PNPM_VERSION }}
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm format:check
      - run: pnpm typecheck
      - run: pnpm i18n:check
      - run: pnpm build
      - run: pnpm audit --prod --audit-level high

  node-unit-coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
      - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4
        with:
          version: ${{ env.PNPM_VERSION }}
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --dir apps/desktop rebuild:node
      - run: pnpm test
      - run: pnpm coverage
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        if: always()
        with:
          name: coverage
          path: |
            packages/core/coverage
            apps/desktop/coverage

  go-race:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
      - uses: actions/setup-go@40f1582b2485089dde7abd97c1529aa768e1baff # v5
        with:
          go-version: '1.25.x'
          cache-dependency-path: daemon/go.sum
      - working-directory: daemon
        run: go test ./...
      - working-directory: daemon
        run: go test -race ./...

  electron-e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
      - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4
        with:
          version: ${{ env.PNPM_VERSION }}
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --dir apps/desktop exec playwright install --with-deps chromium
      - run: pnpm --dir apps/desktop build:daemon
      - run: pnpm --dir apps/desktop exec electron-vite build
      - run: pnpm --dir apps/desktop rebuild:electron
      - working-directory: apps/desktop
        run: xvfb-run -a pnpm exec playwright test
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        if: failure()
        with:
          name: playwright-failure
          path: |
            apps/desktop/playwright-report
            apps/desktop/test-results
```

上述 SHA 已于 2026-08-06 从 GitHub commits API 解析；实施时再次查询对应 major tag，若 upstream 已移动，只在验证新 commit 的签名与 release 说明后更新为新的完整 40 位 SHA。workflow 中不得使用浮动 tag。四个 job 都从 fresh checkout + frozen install 开始；`node-unit-coverage` 只构建 Node ABI，`electron-e2e` 只构建 Electron ABI。Go 版本必须与 `daemon/go.mod` 的 `go 1.25.0` 一致。

- [ ] **Step 3: 本地全门禁验证**

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm test:all
```

Expected 顺序：

```text
lint PASS
format:check PASS
typecheck PASS
unit PASS
coverage PASS（core 85/80，main 80/75，renderer stores 90/85）
go test PASS
go test -race PASS
i18n:check PASS
build PASS
Playwright renderer + Electron + S2 PASS
audit 0 critical/high PASS
```

- [ ] **Step 4: 校验 workflow 与提交**

```bash
corepack pnpm exec prettier --check .github/workflows/pr-quality.yml package.json turbo.json
git add .github/workflows/pr-quality.yml package.json turbo.json
git diff --cached --name-only
git diff --cached
git commit -m "chore: enforce pull request quality gates"
```

Expected staged files: 仅 workflow、root package、turbo config。

## 最终验收

按下列顺序在干净 checkout 执行，不复用规划时的工作树：

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm lint
corepack pnpm format:check
corepack pnpm typecheck
corepack pnpm test
corepack pnpm coverage
corepack pnpm test:go
corepack pnpm i18n:check
corepack pnpm build
corepack pnpm test:e2e
corepack pnpm audit --prod --audit-level high
```

完成条件：

- 9 个 CR ID 各有上述 Task/commit/命令证据。
- `rg` 不再发现生产 IPC 裸字符串；死 `router.tsx` 与 TanStack Router 依赖不存在。
- SecureStorage 只有明确 item-not-found 返回 null，其他系统错误可诊断且脱敏。
- coverage summary 达到 spec 的三个精确阈值。
- S2 不含 `expect(true)`、skip/fixme/only，且真实 Electron 测试验证两轮 mock Provider、文件、Shell 和 completed。
- GitHub PR workflow 四个 job 全绿；外部 runner/权限阻断时保留日志并标记“外部验证待执行”，不得标记 Fixed。
