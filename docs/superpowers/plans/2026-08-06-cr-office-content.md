# CR Office Content Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 SEC-03、PERF-02、REQ-01、REQ-05、STD-04、STD-05，使 Office 文档解析在受限进程内运行，D9/D10 使用用户配置且所有失败通过稳定错误码和双语 UI 呈现。

**Architecture:** Electron main 只负责 capability 解析、受限 `utilityProcess` 生命周期、SecureStorage 和 IPC 接线；PDF/DOCX/XLSX/PPTX 的实际解析全部在独立 parser utility process 内完成。PDF 打开后由短期 `OfficeDocumentSession` 复用一次解析结果，并通过受控自定义协议流式渲染原文件，不再把完整 Base64 复制到 renderer。D9 使用 core 中立 `TranscriptProvider` 和本地 txt/srt/vtt parser；D10 复用用户 Provider/Model 与 SecureStorage，不建立平行的隐藏 Provider 配置。

**Tech Stack:** TypeScript、Electron `utilityProcess`/`protocol`、Vitest、pdfjs-dist、mammoth、JSZip、经 Sonatype 准入后的 ExcelJS、React 19、react-i18next、better-sqlite3。

## Global Constraints

- 工作基线是当前工作树；不得回退或覆盖用户已有改动。
- 本计划依赖安全信任边界 plan 提供的单次/短期 path capability；Office IPC 不得新增裸绝对路径参数。
- `AgentEngine`、REACT loop、`ModelRouter`、`MCPClient` 仍只实现在 `packages/core`。
- renderer 只能导入 `@jarvis/core/renderer`，不得导入 `@jarvis/core` full barrel。
- `packages/protocol` 不得依赖 `@jarvis/core`。
- Provider/model ID 完全由用户定义；代码、配置、测试种子不得提供生产默认 model ID。
- API Key 只进入 SecureStorage；SQLite、WAL、备份、导出和日志只能保存 `apiKeyRef`。
- migration 只能追加 v13+，不得修改 v1-v12。
- 新增用户可见错误必须同时提供 zh-CN/en；main 返回稳定 code 和安全 detail，renderer 决定文案。
- 不引入本地模型、Whisper、本地转写或其他 1.0.0-Preview 排除能力。
- parser 硬限制：原文件 `50 MiB`；PDF `500` 页；XLSX `1,000,000` 个已访问单元格；ZIP `10,000` entries、解压后 `100 MiB`、单 entry `20 MiB`、压缩比 `100:1`；输出 UTF-8 `10 MiB`；RPC 单帧 `256 KiB`；解析超时 `30 s`；utility process V8 old-space `256 MiB`。
- transcript 上传硬限制：`.txt/.srt/.vtt`，UTF-8 文件 `2 MiB`，归一化文本 `1,000,000` 字符；HTTP timeout `20 s`，响应 `2 MiB`。
- 所有新依赖在修改 manifest 前必须通过 Sonatype Developer Trust、许可证和 CVE 检查；拒绝 Critical/High CVE、GPL/AGPL/未知许可证，Developer Trust 目标 `>80`。
- 每个 Task 只暂存该 Task 列出的文件；提交前运行 `git diff --cached --check` 和 `git diff --cached --name-only`。

## File Map

- `docs/dependency-reviews/2026-08-06-office-parser.md`：记录 xlsx 与替代包的 Sonatype、许可证、CVE 和准入结论。
- `packages/protocol/src/office.ts`：Office IPC 请求、响应、稳定错误码和 model capability 类型。
- `packages/core/src/office/transcript.ts`：字幕文本 parser、`TranscriptProvider`、HTTP adapter。
- `packages/core/src/office/image.ts`：无默认 model 的 OpenAI-compatible image adapter。
- `apps/desktop/src/main/office/parser-limits.ts`：唯一 parser 限制常量与 limit 检查。
- `apps/desktop/src/main/office/parser-protocol.ts`：main ↔ utility process 的有界 RPC。
- `apps/desktop/src/main/office/ParserProcess.ts`：utility process 启停、timeout、crash、pending 清理。
- `apps/desktop/src/main/office/parser-worker.ts`：PDF/DOCX/XLSX/PPTX 解析入口。
- `apps/desktop/src/main/office/zip-guard.ts`：解析 ZIP central directory 并在解压前拒绝 zip bomb。
- `apps/desktop/src/main/office/OfficeDocumentSession.ts`：短期文档会话、page text 缓存和协议流。
- `apps/desktop/src/main/ipc/office.ts`：capability → parser/session/transcript/image 的薄接线。
- `apps/desktop/src/main/ipc/providers.ts`：model capability 持久化。
- `apps/desktop/src/renderer/src/components/office/OfficeError.tsx`：稳定 code → i18n 文案。
- `VideoSummary.tsx`、`ImageGenerator.tsx`、`PdfReaderPage.tsx`、`OfficePage.tsx`：D9/D10/PDF/file UI。

---

### Task 1: 阻断式依赖安全准入并替换清单

**Files:**
- Create: `docs/dependency-reviews/2026-08-06-office-parser.md`
- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: Sonatype `getLatestComponentVersion`、`getComponentVersion`、`getRecommendedComponentVersions`。
- Produces: `exceljs` 的锁定版本及可审计准入记录；生产依赖树中不存在 `xlsx@0.18.5`。

- [ ] **Step 1: 获取候选版本但不修改 manifest**

Run:

```bash
cd /Users/baofengbaofeng/Workspace/github/baofengbaofeng/Jarvis
EXCELJS_VERSION="$(pnpm view exceljs version)"
printf '%s\n' "$EXCELJS_VERSION"
```

Expected: 输出 npm registry 的当前稳定版本。随后通过 Sonatype MCP 按顺序调用：

```text
getComponentVersion({ packageUrl: "pkg:npm/xlsx@0.18.5" })
getComponentVersion({ packageUrl: "pkg:npm/exceljs@" + EXCELJS_VERSION })
getRecommendedComponentVersions({ packageUrl: "pkg:npm/exceljs@" + EXCELJS_VERSION })
```

准入必须同时满足：ExcelJS 无 Critical/High CVE、许可证为 MIT/Apache-2.0/BSD、Developer Trust >80；任一条件失败即停止，不运行后续安装命令，并把失败证据写入 review 文档。

- [ ] **Step 2: 写依赖评估证据**

Create `docs/dependency-reviews/2026-08-06-office-parser.md`。直接抄录本次 Sonatype 返回的 PURL、report URL、Developer Trust 数值和许可证；文档结构固定为以下两节，且每个 bullet 必须是查询返回的真实值，不允许示例值或空值：

```markdown
# Office parser dependency review

Date: 2026-08-06

## Removed component
- PURL: `pkg:npm/xlsx@0.18.5`
- Reachability: `apps/desktop/src/main/ipc/office.ts`
- Blocking advisories: `CVE-2023-30533`, `CVE-2024-22363`
- Decision: remove

## Approved component
- PURL: the exact `pkg:npm/exceljs@version` returned in this run
- Sonatype report: the exact report URL returned in this run
- Developer Trust Score: the exact numeric score returned in this run
- License: the exact detected SPDX license returned in this run
- Critical CVEs: `0`
- High CVEs: `0`
- Decision: approved for XLSX-only parsing in the isolated Office parser process

## Scope
- `.xlsx` is supported.
- Legacy binary `.xls` returns `OFFICE_FILE_TYPE_UNSUPPORTED`; it is never passed to ExcelJS.
- Re-run `pnpm audit --prod` after lockfile update.
```

上述四行的说明文字不得进入最终 review 文档；必须改成查询所得的真实 PURL、URL、分数和 SPDX 标识后才可提交。

- [ ] **Step 3: 更新依赖并证明旧包消失**

Run:

```bash
cd /Users/baofengbaofeng/Workspace/github/baofengbaofeng/Jarvis
pnpm --filter @jarvis/desktop remove xlsx
pnpm --filter @jarvis/desktop add exceljs@latest
pnpm why xlsx
pnpm --filter @jarvis/desktop why exceljs
pnpm audit --prod
```

Expected: `pnpm why xlsx` 无生产路径；ExcelJS 版本与准入记录一致；audit 不新增 Critical/High。

- [ ] **Step 4: Commit**

```bash
git add docs/dependency-reviews/2026-08-06-office-parser.md apps/desktop/package.json pnpm-lock.yaml
git diff --cached --check
git diff --cached --name-only
git commit -m "chore: replace vulnerable office spreadsheet dependency"
```

---

### Task 2: 稳定 Office 协议、错误码与资源限制

**Files:**
- Create: `packages/protocol/src/office.ts`
- Create: `packages/protocol/src/office.spec.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/ipc-channels.ts`
- Modify: `packages/protocol/src/ipc-allowlist.ts`
- Create: `apps/desktop/src/main/office/parser-limits.ts`
- Create: `apps/desktop/src/main/office/parser-limits.spec.ts`

**Interfaces:**
- Produces:
  - `OfficeErrorCode`
  - `OfficeResult<T> = { ok:true; value:T } | { ok:false; error:{ code:OfficeErrorCode; detail?:string } }`
  - `ModelCapability = 'chat' | 'vision' | 'image-generation'`
  - `OfficeParseRequest`, `OfficeParseResult`, `OfficeParserLimits`
  - `assertInputFileSize`、`assertParserOutputSize`、`OfficeLimitError`

- [ ] **Step 1: 写失败测试**

`packages/protocol/src/office.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { OFFICE_ERROR_CODES, IpcChannel } from './index';

describe('office protocol', () => {
  it('keeps stable codes and channels in the renderer allowlist', async () => {
    expect(OFFICE_ERROR_CODES).toContain('OFFICE_PARSE_TIMEOUT');
    expect(OFFICE_ERROR_CODES).toContain('TRANSCRIPT_PROVIDER_REQUIRED');
    expect(OFFICE_ERROR_CODES).toContain('IMAGE_MODEL_REQUIRED');
    expect(IpcChannel.officePdfOpen).toBe('office.pdf.open');
  });
});
```

`apps/desktop/src/main/office/parser-limits.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_OFFICE_PARSER_LIMITS, assertInputFileSize, assertParserOutputSize } from './parser-limits';

describe('parser limits', () => {
  it('pins the security limits', () => {
    expect(DEFAULT_OFFICE_PARSER_LIMITS).toEqual({
      maxFileBytes: 50 * 1024 * 1024,
      maxPdfPages: 500,
      maxSpreadsheetCells: 1_000_000,
      maxZipEntries: 10_000,
      maxZipEntryBytes: 20 * 1024 * 1024,
      maxUncompressedBytes: 100 * 1024 * 1024,
      maxCompressionRatio: 100,
      maxOutputBytes: 10 * 1024 * 1024,
      maxFrameBytes: 256 * 1024,
      timeoutMs: 30_000,
      maxOldSpaceMb: 256,
    });
  });

  it('uses stable codes for input and output overflow', () => {
    expect(() => assertInputFileSize(50 * 1024 * 1024 + 1)).toThrowError(
      expect.objectContaining({ code: 'OFFICE_FILE_TOO_LARGE' }),
    );
    expect(() => assertParserOutputSize('x'.repeat(10 * 1024 * 1024 + 1))).toThrowError(
      expect.objectContaining({ code: 'OFFICE_OUTPUT_TOO_LARGE' }),
    );
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @jarvis/protocol vitest run src/office.spec.ts
pnpm --filter @jarvis/desktop vitest run src/main/office/parser-limits.spec.ts
```

Expected: FAIL，模块或导出不存在。

- [ ] **Step 3: 实现协议**

`packages/protocol/src/office.ts`:

```ts
export const OFFICE_ERROR_CODES = [
  'OFFICE_CAPABILITY_INVALID',
  'OFFICE_FILE_TYPE_UNSUPPORTED',
  'OFFICE_FILE_TOO_LARGE',
  'OFFICE_PAGE_LIMIT_EXCEEDED',
  'OFFICE_CELL_LIMIT_EXCEEDED',
  'OFFICE_ARCHIVE_LIMIT_EXCEEDED',
  'OFFICE_OUTPUT_TOO_LARGE',
  'OFFICE_PARSE_TIMEOUT',
  'OFFICE_PARSE_MEMORY_LIMIT',
  'OFFICE_PARSE_CRASHED',
  'OFFICE_PARSE_FAILED',
  'OFFICE_DOCUMENT_EXPIRED',
  'TRANSCRIPT_PROVIDER_REQUIRED',
  'TRANSCRIPT_FILE_INVALID',
  'TRANSCRIPT_FILE_TOO_LARGE',
  'TRANSCRIPT_HTTP_TIMEOUT',
  'TRANSCRIPT_HTTP_FAILED',
  'IMAGE_PROVIDER_REQUIRED',
  'IMAGE_MODEL_REQUIRED',
  'IMAGE_MODEL_NOT_CAPABLE',
  'IMAGE_API_KEY_MISSING',
  'IMAGE_REQUEST_FAILED',
] as const;

export type OfficeErrorCode = typeof OFFICE_ERROR_CODES[number];
export type OfficeError = { code: OfficeErrorCode; detail?: string };
export type OfficeResult<T> = { ok: true; value: T } | { ok: false; error: OfficeError };
export type ModelCapability = 'chat' | 'vision' | 'image-generation';
export type OfficeFileKind = 'pdf' | 'docx' | 'xlsx' | 'pptx';

export interface OfficeParseRequest {
  requestId: string;
  kind: OfficeFileKind;
  filePath: string;
}

export interface OfficeParseResult {
  kind: OfficeFileKind;
  text: string;
  pageTexts?: string[];
  pageCount?: number;
  cellCount?: number;
}
```

Append the Office channel constants to `packages/protocol/src/ipc-channels.ts`:

```ts
officePdfOpen: 'office.pdf.open',
officePdfSummarize: 'office.pdf.summarize',
officeFileAnalyze: 'office.file.analyze',
officeVideoSummarize: 'office.video.summarize',
officeImageGenerate: 'office.image.generate',
officeTranscriptConfigGet: 'office.transcript.config.get',
officeTranscriptConfigSet: 'office.transcript.config.set',
```

Re-export `./office` from `packages/protocol/src/index.ts` and replace the matching Office string literals in `ipc-allowlist.ts` with `IpcChannel.*`.

- [ ] **Step 4: 实现唯一限制表**

`apps/desktop/src/main/office/parser-limits.ts`:

```ts
import type { OfficeErrorCode } from '@jarvis/protocol';

export interface OfficeParserLimits {
  maxFileBytes: number;
  maxPdfPages: number;
  maxSpreadsheetCells: number;
  maxZipEntries: number;
  maxZipEntryBytes: number;
  maxUncompressedBytes: number;
  maxCompressionRatio: number;
  maxOutputBytes: number;
  maxFrameBytes: number;
  timeoutMs: number;
  maxOldSpaceMb: number;
}

export const DEFAULT_OFFICE_PARSER_LIMITS: Readonly<OfficeParserLimits> = Object.freeze({
  maxFileBytes: 50 * 1024 * 1024,
  maxPdfPages: 500,
  maxSpreadsheetCells: 1_000_000,
  maxZipEntries: 10_000,
  maxZipEntryBytes: 20 * 1024 * 1024,
  maxUncompressedBytes: 100 * 1024 * 1024,
  maxCompressionRatio: 100,
  maxOutputBytes: 10 * 1024 * 1024,
  maxFrameBytes: 256 * 1024,
  timeoutMs: 30_000,
  maxOldSpaceMb: 256,
});

export class OfficeLimitError extends Error {
  constructor(public readonly code: OfficeErrorCode, message: string) {
    super(message);
    this.name = 'OfficeLimitError';
  }
}

export function assertInputFileSize(bytes: number, limits = DEFAULT_OFFICE_PARSER_LIMITS): void {
  if (bytes > limits.maxFileBytes) throw new OfficeLimitError('OFFICE_FILE_TOO_LARGE', `input bytes ${bytes}`);
}

export function assertParserOutputSize(text: string, limits = DEFAULT_OFFICE_PARSER_LIMITS): void {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > limits.maxOutputBytes) throw new OfficeLimitError('OFFICE_OUTPUT_TOO_LARGE', `output bytes ${bytes}`);
}
```

- [ ] **Step 5: 验证**

```bash
pnpm --filter @jarvis/protocol vitest run src/office.spec.ts
pnpm --filter @jarvis/desktop vitest run src/main/office/parser-limits.spec.ts
pnpm --filter @jarvis/protocol typecheck
pnpm --filter @jarvis/desktop typecheck
```

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/office.ts packages/protocol/src/office.spec.ts packages/protocol/src/index.ts packages/protocol/src/ipc-channels.ts packages/protocol/src/ipc-allowlist.ts apps/desktop/src/main/office/parser-limits.ts apps/desktop/src/main/office/parser-limits.spec.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "feat: define bounded office parser protocol"
```

---

### Task 3: 受限 utility process 与有界 RPC

**Files:**
- Create: `apps/desktop/src/main/office/parser-protocol.ts`
- Create: `apps/desktop/src/main/office/ParserProcess.ts`
- Create: `apps/desktop/src/main/office/ParserProcess.spec.ts`
- Modify: `apps/desktop/electron.vite.config.ts`

**Interfaces:**
- Consumes: Task 2 `OfficeParseRequest`、`OfficeParseResult`、`OfficeResult`、`DEFAULT_OFFICE_PARSER_LIMITS`。
- Produces:
  - `ParserChild` structural interface
  - `ParserProcess.parse(input): Promise<OfficeResult<OfficeParseResult>>`
  - `ParserProcess.dispose(): void`
  - utility process `--max-old-space-size=256`、每请求 `30 s` timeout、`256 KiB` frame gate。

- [ ] **Step 1: 写失败测试**

`apps/desktop/src/main/office/ParserProcess.spec.ts`:

```ts
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { ParserProcess, type ParserChild } from './ParserProcess';

class FakeChild extends EventEmitter implements ParserChild {
  sent: unknown[] = [];
  killed = false;
  postMessage(message: unknown): void { this.sent.push(message); }
  kill(): void { this.killed = true; this.emit('exit', 1); }
}

describe('ParserProcess', () => {
  it('passes the memory ceiling and resolves a correlated response', async () => {
    const child = new FakeChild();
    const spawn = vi.fn(() => child);
    const parser = new ParserProcess({ spawn });
    const pending = parser.parse({ kind: 'pdf', filePath: '/tmp/a.pdf' });
    const request = child.sent[0] as { requestId: string };
    child.emit('message', { requestId: request.requestId, ok: true, value: { kind: 'pdf', text: 'x' } });
    await expect(pending).resolves.toEqual({ ok: true, value: { kind: 'pdf', text: 'x' } });
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ execArgv: ['--max-old-space-size=256'] }));
  });

  it('kills a timed-out child and rejects every pending request', async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const parser = new ParserProcess({ spawn: () => child });
    const pending = parser.parse({ kind: 'pdf', filePath: '/tmp/a.pdf' });
    await vi.advanceTimersByTimeAsync(30_001);
    await expect(pending).resolves.toEqual({ ok: false, error: { code: 'OFFICE_PARSE_TIMEOUT' } });
    expect(child.killed).toBe(true);
    vi.useRealTimers();
  });

  it('maps child exit and oversized frames to stable codes', async () => {
    const crashed = new FakeChild();
    const parser = new ParserProcess({ spawn: () => crashed });
    const pending = parser.parse({ kind: 'docx', filePath: '/tmp/a.docx' });
    crashed.emit('exit', 1);
    await expect(pending).resolves.toEqual({ ok: false, error: { code: 'OFFICE_PARSE_CRASHED' } });

    const noisy = new FakeChild();
    const parser2 = new ParserProcess({ spawn: () => noisy });
    const pending2 = parser2.parse({ kind: 'docx', filePath: '/tmp/a.docx' });
    noisy.emit('message', { requestId: 'x', value: 'x'.repeat(256 * 1024 + 1) });
    await expect(pending2).resolves.toEqual({ ok: false, error: { code: 'OFFICE_PARSE_CRASHED' } });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @jarvis/desktop vitest run src/main/office/ParserProcess.spec.ts
```

Expected: FAIL，`ParserProcess` 不存在。

- [ ] **Step 3: 实现 RPC envelope 与进程管理**

`apps/desktop/src/main/office/parser-protocol.ts`:

```ts
import type { OfficeParseRequest, OfficeParseResult, OfficeResult } from '@jarvis/protocol';

export type ParserRequestMessage = OfficeParseRequest;
export type ParserResponseMessage = { requestId: string } & OfficeResult<OfficeParseResult>;

export function frameBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}
```

`apps/desktop/src/main/office/ParserProcess.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { OfficeFileKind, OfficeParseResult, OfficeResult } from '@jarvis/protocol';
import { DEFAULT_OFFICE_PARSER_LIMITS } from './parser-limits';
import { frameBytes, type ParserResponseMessage } from './parser-protocol';

export interface ParserChild {
  postMessage(message: unknown): void;
  kill(): void;
  on(event: 'message' | 'exit' | 'error', listener: (...args: any[]) => void): this;
}

interface SpawnOptions { execArgv: string[]; serviceName: string }
type Spawn = (options: SpawnOptions) => ParserChild;

export class ParserProcess {
  private child: ParserChild | null = null;
  private pending = new Map<string, { resolve: (value: OfficeResult<OfficeParseResult>) => void; timer: NodeJS.Timeout }>();

  constructor(private readonly deps: { spawn: Spawn }) {}

  private start(): ParserChild {
    if (this.child) return this.child;
    const child = this.deps.spawn({
      execArgv: [`--max-old-space-size=${DEFAULT_OFFICE_PARSER_LIMITS.maxOldSpaceMb}`],
      serviceName: 'JARVIS Office Parser',
    });
    child.on('message', (message) => this.onMessage(message));
    child.on('error', () => this.failAll('OFFICE_PARSE_CRASHED'));
    child.on('exit', () => this.failAll('OFFICE_PARSE_CRASHED'));
    this.child = child;
    return child;
  }

  parse(input: { kind: OfficeFileKind; filePath: string }): Promise<OfficeResult<OfficeParseResult>> {
    const requestId = randomUUID();
    const child = this.start();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ ok: false, error: { code: 'OFFICE_PARSE_TIMEOUT' } });
        child.kill();
        this.child = null;
      }, DEFAULT_OFFICE_PARSER_LIMITS.timeoutMs);
      this.pending.set(requestId, { resolve, timer });
      child.postMessage({ requestId, ...input });
    });
  }

  private onMessage(message: unknown): void {
    if (frameBytes(message) > DEFAULT_OFFICE_PARSER_LIMITS.maxFrameBytes) {
      this.child?.kill();
      this.failAll('OFFICE_PARSE_CRASHED');
      return;
    }
    const response = message as ParserResponseMessage;
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(response.requestId);
    pending.resolve(response.ok
      ? { ok: true, value: response.value }
      : { ok: false, error: response.error });
  }

  private failAll(code: 'OFFICE_PARSE_CRASHED'): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error: { code } });
    }
    this.pending.clear();
    this.child = null;
  }

  dispose(): void {
    this.child?.kill();
    this.failAll('OFFICE_PARSE_CRASHED');
  }
}
```

在 `electron.vite.config.ts` 的 main build 中加入 parser worker entry，确保产物固定为 `out/main/parser-worker.js`；生产 spawn 使用：

```ts
utilityProcess.fork(join(__dirname, 'parser-worker.js'), [], {
  execArgv,
  serviceName,
  stdio: 'ignore',
});
```

禁止向 child 传环境密钥、任意输出路径或 renderer 提供的 argv。

- [ ] **Step 4: 验证**

```bash
pnpm --filter @jarvis/desktop vitest run src/main/office/ParserProcess.spec.ts
pnpm --filter @jarvis/desktop typecheck
pnpm --filter @jarvis/desktop build
test -f apps/desktop/out/main/parser-worker.js
```

Expected: PASS，worker 产物存在。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/office/parser-protocol.ts apps/desktop/src/main/office/ParserProcess.ts apps/desktop/src/main/office/ParserProcess.spec.ts apps/desktop/electron.vite.config.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "feat: isolate office parsing in utility process"
```

---

### Task 4: 实现 ZIP guard 与四种真实 parser

**Files:**
- Create: `apps/desktop/src/main/office/zip-guard.ts`
- Create: `apps/desktop/src/main/office/zip-guard.spec.ts`
- Create: `apps/desktop/src/main/office/parser-worker.ts`
- Create: `apps/desktop/src/main/office/parser-worker.spec.ts`
- Modify: `apps/desktop/src/main/office/parser-protocol.ts`
- Modify: `apps/desktop/src/main/office/ParserProcess.ts`
- Modify: `apps/desktop/src/main/office/ParserProcess.spec.ts`
- Modify: `packages/core/src/office/files.ts`
- Modify: `packages/core/src/office/files.spec.ts`
- Modify: `packages/core/src/office/index.ts`
- Modify: `packages/core/src/renderer.ts`

**Interfaces:**
- Consumes: Task 1 ExcelJS、Task 2 limits/protocol。
- Produces:
  - `inspectZipCentralDirectory(buffer, limits): ZipInspection`
  - `parseOfficeFile(request, deps?): Promise<OfficeParseResult>`
  - `.xls` 明确返回 `OFFICE_FILE_TYPE_UNSUPPORTED`
  - child only reads the single capability-resolved `filePath` and emits bounded responses。

- [ ] **Step 1: 写 ZIP bomb 与文件分类失败测试**

`packages/core/src/office/files.spec.ts` 增加：

```ts
it('does not route legacy binary xls into the xlsx parser', () => {
  expect(classifyFile('legacy.xls')).toBe('other');
  expect(classifyFile('modern.xlsx')).toBe('xlsx');
});
```

`apps/desktop/src/main/office/zip-guard.spec.ts`:

```ts
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { inspectZipCentralDirectory } from './zip-guard';

describe('zip guard', () => {
  it('accepts a small archive and reports declared bytes', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:t>Hello</w:t>');
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const result = inspectZipCentralDirectory(buffer);
    expect(result.entries).toBe(1);
    expect(result.uncompressedBytes).toBeGreaterThan(0);
  });

  it('rejects entry count and compression-ratio bombs before extraction', async () => {
    const many = new JSZip();
    for (let i = 0; i < 10_001; i++) many.file(`x/${i}`, '');
    const manyBuffer = await many.generateAsync({ type: 'nodebuffer' });
    expect(() => inspectZipCentralDirectory(manyBuffer)).toThrowError(
      expect.objectContaining({ code: 'OFFICE_ARCHIVE_LIMIT_EXCEEDED' }),
    );

    const bomb = new JSZip();
    bomb.file('word/document.xml', 'A'.repeat(2_000_000));
    const bombBuffer = await bomb.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    expect(() => inspectZipCentralDirectory(bombBuffer)).toThrowError(
      expect.objectContaining({ code: 'OFFICE_ARCHIVE_LIMIT_EXCEEDED' }),
    );
  });
});
```

- [ ] **Step 2: 写真实 XLSX/PPTX parser 测试**

`apps/desktop/src/main/office/parser-worker.spec.ts`:

```ts
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseOfficeFile } from './parser-worker';

describe('office parser worker', () => {
  it('parses a real xlsx workbook and counts visited cells', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-xlsx-'));
    const path = join(dir, 'sample.xlsx');
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Sheet 1').addRows([['Name', 'Score'], ['Ada', 10]]);
    await workbook.xlsx.writeFile(path);
    const result = await parseOfficeFile({ requestId: '1', kind: 'xlsx', filePath: path });
    expect(result.text).toContain('Ada');
    expect(result.cellCount).toBe(4);
  });

  it('rejects an xlsx when the actual visited-cell count crosses the limit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-xlsx-limit-'));
    const path = join(dir, 'sample.xlsx');
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Sheet 1').addRows([[1, 2], [3, 4]]);
    await workbook.xlsx.writeFile(path);
    await expect(parseOfficeFile(
      { requestId: '2', kind: 'xlsx', filePath: path },
      { limits: { maxSpreadsheetCells: 3 } },
    )).rejects.toMatchObject({ code: 'OFFICE_CELL_LIMIT_EXCEEDED' });
  });

  it('parses a real pptx zip after central-directory validation', async () => {
    const zip = new JSZip();
    zip.file('ppt/slides/slide1.xml', '<a:t>Hello</a:t><a:t>World</a:t>');
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-pptx-'));
    const path = join(dir, 'sample.pptx');
    await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }));
    const result = await parseOfficeFile({ requestId: '3', kind: 'pptx', filePath: path });
    expect(result.text).toBe('Hello\nWorld');
  });

  it('rejects PDF page overflow before reading page text', async () => {
    await expect(parseOfficeFile(
      { requestId: '4', kind: 'pdf', filePath: '/virtual/a.pdf' },
      {
        stat: async () => ({ size: 1 }),
        readFile: async () => Buffer.from('%PDF'),
        getPdfDocument: async () => ({ numPages: 501, getPage: async () => { throw new Error('must not read'); }, destroy: async () => {} }),
      },
    )).rejects.toMatchObject({ code: 'OFFICE_PAGE_LIMIT_EXCEEDED' });
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

```bash
pnpm --filter @jarvis/core vitest run src/office/files.spec.ts
pnpm --filter @jarvis/desktop vitest run src/main/office/zip-guard.spec.ts src/main/office/parser-worker.spec.ts
```

Expected: FAIL。

- [ ] **Step 4: 实现 ZIP central-directory preflight**

`zip-guard.ts` 必须遍历 ZIP central directory signature `0x02014b50`，读取 compressed size、uncompressed size 和 filename length；在调用 JSZip/mammoth/ExcelJS 前检查：

```ts
if (entries > limits.maxZipEntries) fail();
if (entry.uncompressedBytes > limits.maxZipEntryBytes) fail();
if (totalUncompressed > limits.maxUncompressedBytes) fail();
if (entry.compressedBytes === 0
  ? entry.uncompressedBytes > 0
  : entry.uncompressedBytes / entry.compressedBytes > limits.maxCompressionRatio) fail();
```

`fail()` 必须抛：

```ts
throw new OfficeLimitError('OFFICE_ARCHIVE_LIMIT_EXCEEDED', 'zip limits exceeded');
```

不得先 `JSZip.loadAsync` 再统计。

- [ ] **Step 5: 实现 parser worker**

`parseOfficeFile` 执行顺序固定为：`stat` → 文件大小 gate → `readFile` 一次 → ZIP preflight（docx/xlsx/pptx）→ parser → 页/单元格 gate → output gate。XLSX 使用 ExcelJS streaming reader并在每个非空 cell 上递增计数：

```ts
for await (const worksheet of new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
  worksheets: 'emit',
  sharedStrings: 'cache',
  hyperlinks: 'ignore',
  styles: 'ignore',
})) {
  const rows: string[] = [];
  for await (const row of worksheet) {
    const values: string[] = [];
    row.eachCell({ includeEmpty: false }, (cell) => {
      cellCount += 1;
      if (cellCount > limits.maxSpreadsheetCells) {
        throw new OfficeLimitError('OFFICE_CELL_LIMIT_EXCEEDED', `cells ${cellCount}`);
      }
      values.push(String(cell.text ?? ''));
    });
    rows.push(values.join('\t'));
  }
  sheets.push(`# ${worksheet.name}\n${rows.join('\n')}`);
}
```

PDF 在 `doc.numPages` 检查通过后逐页取 `getTextContent()`；DOCX/PPTX 只在 ZIP preflight 后调用 mammoth/JSZip。worker 顶层只监听结构化 message：

```ts
process.parentPort?.on('message', async (event) => {
  const request = event.data as OfficeParseRequest;
  try {
    const value = await parseOfficeFile(request);
    process.parentPort?.postMessage({ requestId: request.requestId, ok: true, value });
  } catch (error) {
    process.parentPort?.postMessage({
      requestId: request.requestId,
      ok: false,
      error: toStableParserError(error),
    });
  }
});
```

发送前再次调用 `frameBytes`；结果超过单帧时按 `{ requestId, sequence, final, chunk }` 分片，每片 UTF-8 最大 `256 KiB`。`parser-protocol.ts` 定义 chunk envelope，`ParserProcess` 按 requestId 保存 `nextSequence` 和累计 byte count：序号跳跃、重复、单帧超限或累计超过 `10 MiB` 时 kill child 并以 `OFFICE_PARSE_CRASHED`/`OFFICE_OUTPUT_TOO_LARGE` 结束全部相关 pending；收到 `final:true` 后只 JSON.parse 一次并清空 accumulator。`ParserProcess.spec.ts` 必须覆盖多字节 UTF-8 跨片重组、乱序片、总量超限和 child 退出时 accumulator 清理。

- [ ] **Step 6: 验证**

```bash
pnpm --filter @jarvis/core vitest run src/office/files.spec.ts
pnpm --filter @jarvis/desktop vitest run src/main/office/zip-guard.spec.ts src/main/office/parser-worker.spec.ts
pnpm --filter @jarvis/desktop typecheck
pnpm --filter @jarvis/desktop build
```

Expected: PASS；测试中真实生成的 XLSX/PPTX 可解析，limit cases 使用稳定 code。

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/office/zip-guard.ts apps/desktop/src/main/office/zip-guard.spec.ts apps/desktop/src/main/office/parser-worker.ts apps/desktop/src/main/office/parser-worker.spec.ts apps/desktop/src/main/office/parser-protocol.ts apps/desktop/src/main/office/ParserProcess.ts apps/desktop/src/main/office/ParserProcess.spec.ts packages/core/src/office/files.ts packages/core/src/office/files.spec.ts packages/core/src/office/index.ts packages/core/src/renderer.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "fix: bound office archive and document parsing"
```

---

### Task 5: PDF 单读会话、受控协议与 parser IPC 接线

**Files:**
- Create: `apps/desktop/src/main/office/OfficeDocumentSession.ts`
- Create: `apps/desktop/src/main/office/OfficeDocumentSession.spec.ts`
- Modify: `apps/desktop/src/main/ipc/office.ts`
- Modify: `apps/desktop/src/main/ipc/office.spec.ts`
- Modify: `apps/desktop/src/main/ipc/IpcRouter.ts`
- Modify: `apps/desktop/src/renderer/src/pages/PdfReaderPage.tsx`
- Create: `apps/desktop/src/renderer/src/pages/PdfReaderPage.spec.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/OfficePage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/OfficePage.spec.tsx`

**Interfaces:**
- Consumes:
  - 安全 plan `PathCapabilityService.consume(token, { operation:'office:read' }): Promise<{ canonicalPath:string; name:string; size:number }>`
  - Task 3 `ParserProcess`
- Produces:
  - `OfficeDocumentSession.open(capability): Promise<OfficeResult<{ documentId; documentUrl; pages }>>`
  - `OfficeDocumentSession.getPageTexts(documentId, from, to)`
  - `jarvis-office://document/<opaque-id>` protocol stream
  - `office.pdf.open({ capability })`
  - `office.pdf.summarize({ documentId, from, to })`
  - `office.file.analyze({ capability, name })`

- [ ] **Step 1: 写会话失败测试**

```ts
import { describe, expect, it, vi } from 'vitest';
import { OfficeDocumentSession } from './OfficeDocumentSession';

describe('OfficeDocumentSession', () => {
  it('parses once and reuses page text for summaries', async () => {
    const parse = vi.fn(async () => ({ ok: true, value: { kind: 'pdf', text: 'p1\np2', pageCount: 2, pageTexts: ['p1', 'p2'] } }));
    const sessions = new OfficeDocumentSession({
      resolveCapability: async () => ({ canonicalPath: '/safe/a.pdf', name: 'a.pdf', size: 100 }),
      parse,
      now: () => 1000,
    });
    const opened = await sessions.open('cap');
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(sessions.getPageTexts(opened.value.documentId, 1, 2)).toEqual({ ok: true, value: ['p1', 'p2'] });
    expect(parse).toHaveBeenCalledTimes(1);
    expect(opened.value.documentUrl).toMatch(/^jarvis-office:\/\/document\//);
  });

  it('expires sessions and bounds cached text', async () => {
    let now = 0;
    const sessions = new OfficeDocumentSession({
      resolveCapability: async () => ({ canonicalPath: '/safe/a.pdf', name: 'a.pdf', size: 100 }),
      parse: async () => ({ ok: true, value: { kind: 'pdf', text: 'x', pageCount: 1, pageTexts: ['x'] } }),
      now: () => now,
    });
    const opened = await sessions.open('cap');
    if (!opened.ok) throw new Error('open failed');
    now = 15 * 60_000 + 1;
    expect(sessions.getPageTexts(opened.value.documentId, 1, 1)).toEqual({
      ok: false,
      error: { code: 'OFFICE_DOCUMENT_EXPIRED' },
    });
  });
});
```

- [ ] **Step 2: 写 PDF renderer 失败测试**

`PdfReaderPage.spec.tsx`:

```tsx
it('loads pdfjs from an opaque document URL and summarizes by document id', async () => {
  const invoke = vi.fn(async (channel: string) => channel === 'office.pdf.open'
    ? { ok: true, value: { documentId: 'd1', documentUrl: 'jarvis-office://document/d1', pages: 2 } }
    : { ok: true, value: { result: 'summary' } });
  (window as any).jarvis = { invoke };
  render(<PdfReaderPage initialCapability="cap-1" />);
  fireEvent.click(screen.getByTestId('pdf-open'));
  await screen.findByTestId('pdf-pager');
  fireEvent.click(screen.getByTestId('pdf-summarize'));
  expect(invoke).toHaveBeenCalledWith('office.pdf.open', { capability: 'cap-1' });
  expect(invoke).toHaveBeenCalledWith('office.pdf.summarize', { documentId: 'd1', from: 1, to: 2 });
  expect(JSON.stringify(invoke.mock.calls)).not.toContain('base64');
});
```

- [ ] **Step 3: 运行测试确认失败**

```bash
pnpm --filter @jarvis/desktop vitest run src/main/office/OfficeDocumentSession.spec.ts src/renderer/src/pages/PdfReaderPage.spec.tsx
```

Expected: FAIL。

- [ ] **Step 4: 实现 session 与 custom protocol**

`OfficeDocumentSession` 保存最多 `4` 个 session、总 page text 最多 `10 MiB`、TTL `15 min`；LRU 淘汰时同步撤销 URL。protocol handler 只接受 map 中存在且未过期的 UUID：

```ts
protocol.handle('jarvis-office', async (request) => {
  const documentId = new URL(request.url).pathname.split('/').filter(Boolean).at(-1) ?? '';
  const path = sessions.resolveStreamPath(documentId);
  if (!path) return new Response(null, { status: 404 });
  return net.fetch(pathToFileURL(path).toString());
});
```

不得把 path 放进 URL、日志或 IPC response。

- [ ] **Step 5: 重写 Office IPC**

删除 `readFileSync`、main 中的 `getDocument`、`mammoth`、`xlsx`/ExcelJS、JSZip 解析和 `resolveCjsDefault`。handler 只做：

```ts
router.register(IpcChannel.officePdfOpen, async (_event, request: { capability: string }) =>
  sessions.open(request.capability));

router.register(IpcChannel.officePdfSummarize, async (_event, request: { documentId: string; from: number; to: number }) => {
  const pages = sessions.getPageTexts(request.documentId, request.from, request.to);
  if (!pages.ok) return pages;
  const result = await summarizeChunks(pages.value, request.from, modelRouter);
  return { ok: true, value: { result } };
});

router.register(IpcChannel.officeFileAnalyze, async (_event, request: { capability: string; name: string }) => {
  const resolved = await pathCapabilities.consume(request.capability, { operation: 'office:read' });
  const kind = classifyFile(request.name);
  if (kind === 'other' || kind === 'image') {
    return { ok: false, error: { code: 'OFFICE_FILE_TYPE_UNSUPPORTED' } };
  }
  const parsed = await parser.parse({ kind, filePath: resolved.canonicalPath });
  if (!parsed.ok) return parsed;
  const result = await analyzeText(parsed.value.text, modelRouter);
  return { ok: true, value: { result } };
});
```

`IpcRouter.dispose()` 必须调用 `ParserProcess.dispose()`、`OfficeDocumentSession.dispose()` 和 `protocol.unhandle('jarvis-office')`。

- [ ] **Step 6: 重写 renderer**

`PdfReaderPage` 不再维护 path/Base64；使用 `documentUrl`：

```ts
const doc = await pdfjs.getDocument({ url: opened.value.documentUrl }).promise;
```

`OfficePage.handleAttach` 改为传 `{ capability, name }`。若安全 plan 的 DropZone 尚未提供 capability，先完成该依赖，不得恢复 renderer path。

- [ ] **Step 7: 验证**

```bash
pnpm --filter @jarvis/desktop vitest run src/main/office/OfficeDocumentSession.spec.ts src/main/ipc/office.spec.ts src/renderer/src/pages/PdfReaderPage.spec.tsx src/renderer/src/pages/OfficePage.spec.tsx
pnpm --filter @jarvis/desktop typecheck
pnpm --filter @jarvis/desktop build
rg "readFileSync|getDocument|toString\\('base64'\\)|import\\('xlsx'\\)" apps/desktop/src/main/ipc/office.ts
```

Expected: tests/build PASS；最后 `rg` 无匹配。

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/main/office/OfficeDocumentSession.ts apps/desktop/src/main/office/OfficeDocumentSession.spec.ts apps/desktop/src/main/ipc/office.ts apps/desktop/src/main/ipc/office.spec.ts apps/desktop/src/main/ipc/IpcRouter.ts apps/desktop/src/renderer/src/pages/PdfReaderPage.tsx apps/desktop/src/renderer/src/pages/PdfReaderPage.spec.tsx apps/desktop/src/renderer/src/pages/OfficePage.tsx apps/desktop/src/renderer/src/pages/OfficePage.spec.tsx
git diff --cached --check
git diff --cached --name-only
git commit -m "fix: stream and reuse parsed office documents"
```

---

### Task 6: TranscriptProvider HTTP 与 txt/srt/vtt 回退

**Files:**
- Create: `packages/core/src/office/transcript.ts`
- Create: `packages/core/src/office/transcript.spec.ts`
- Modify: `packages/core/src/office/video.ts`
- Modify: `packages/core/src/office/video.spec.ts`
- Modify: `packages/core/src/office/index.ts`
- Create: `apps/desktop/src/main/office/TranscriptConfigStore.ts`
- Create: `apps/desktop/src/main/office/TranscriptConfigStore.spec.ts`
- Modify: `apps/desktop/src/main/ipc/office.ts`
- Modify: `apps/desktop/src/main/ipc/office.spec.ts`
- Modify: `apps/desktop/src/main/ipc/IpcRouter.ts`
- Modify: `apps/desktop/src/renderer/src/components/office/VideoSummary.tsx`
- Modify: `apps/desktop/src/renderer/src/components/office/VideoSummary.spec.tsx`

**Interfaces:**
- Produces:
  - `TranscriptRequest { url?; title?; uploadedText?; uploadedName? }`
  - `TranscriptProvider.transcribe(request, signal): Promise<string>`
  - `TranscriptHttpConfig`
  - `createHttpTranscriptProvider`（只消费安全 plan 的 `SafeHttpClient`，不直接调用全局 fetch）
  - `parseUploadedTranscript(name, text)`
  - settings key `office.transcript.http` containing endpoint/auth/responseField/apiKeyRef only。

- [ ] **Step 1: 写 core 失败测试**

```ts
import { describe, expect, it, vi } from 'vitest';
import { createHttpTranscriptProvider, parseUploadedTranscript } from './transcript';

describe('transcript', () => {
  it('normalizes txt, srt and vtt without timestamps or cue numbers', () => {
    expect(parseUploadedTranscript('a.txt', ' hello \r\nworld ')).toBe('hello\nworld');
    expect(parseUploadedTranscript('a.srt', '1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\nWorld')).toBe('Hello\nWorld');
    expect(parseUploadedTranscript('a.vtt', 'WEBVTT\n\n00:00.000 --> 00:01.000\nHello')).toBe('Hello');
    expect(() => parseUploadedTranscript('a.md', 'x')).toThrowError(
      expect.objectContaining({ code: 'TRANSCRIPT_FILE_INVALID' }),
    );
  });

  it('posts URL metadata with configured auth and extracts configured response field', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ data: { transcript: 'spoken words' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const provider = createHttpTranscriptProvider({
      config: {
        endpoint: 'https://transcript.example/v1/transcribe',
        auth: { mode: 'custom', headerName: 'X-Token', prefix: 'Token ' },
        responseField: 'data.transcript',
      },
      apiKey: 'secret',
      http: { request } as never,
    });
    await expect(provider.transcribe({ url: 'https://video.example/v/1', title: 'Demo' }, new AbortController().signal)).resolves.toBe('spoken words');
    expect(request).toHaveBeenCalledWith(
      'https://transcript.example/v1/transcribe',
      expect.objectContaining({ headers: expect.objectContaining({ 'X-Token': 'Token secret' }) }),
      { signal: expect.any(AbortSignal), timeoutMs: 20_000, maxRedirects: 3, maxResponseBytes: 2 * 1024 * 1024 },
    );
  });

  it('honors abort and the 2 MiB response limit', async () => {
    const provider = createHttpTranscriptProvider({
      config: { endpoint: 'https://t.example', auth: { mode: 'bearer' }, responseField: 'text' },
      apiKey: 'secret',
      http: { request: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)) } as never,
    });
    await expect(provider.transcribe({ url: 'https://v.example' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'TRANSCRIPT_HTTP_FAILED' });
  });
});
```

- [ ] **Step 2: 写 SecureStorage 配置测试**

```ts
it('stores only apiKeyRef in settings', async () => {
  const values = new Map<string, unknown>();
  const secrets = { set: vi.fn(async () => {}), get: vi.fn(async () => 'secret'), delete: vi.fn(async () => {}) };
  const store = new TranscriptConfigStore({
    settings: { get: (k) => values.get(k), set: (k, v) => values.set(k, v) },
    secrets,
  });
  await store.set({
    endpoint: 'https://transcript.example/v1',
    apiKey: 'top-secret',
    auth: { mode: 'bearer' },
    responseField: 'text',
  });
  expect(JSON.stringify(values.get('office.transcript.http'))).not.toContain('top-secret');
  expect(values.get('office.transcript.http')).toMatchObject({ apiKeyRef: 'office:transcript:key' });
  expect(secrets.set).toHaveBeenCalledWith('office:transcript:key', 'top-secret');
});
```

- [ ] **Step 3: 运行测试确认失败**

```bash
pnpm --filter @jarvis/core vitest run src/office/transcript.spec.ts src/office/video.spec.ts
pnpm --filter @jarvis/desktop vitest run src/main/office/TranscriptConfigStore.spec.ts src/main/ipc/office.spec.ts
```

Expected: FAIL。

- [ ] **Step 4: 实现 core TranscriptProvider**

```ts
export interface TranscriptRequest {
  url?: string;
  title?: string;
  uploadedText?: string;
  uploadedName?: string;
}

export interface TranscriptProvider {
  transcribe(request: TranscriptRequest, signal: AbortSignal): Promise<string>;
}

export interface TranscriptHttpConfig {
  endpoint: string;
  auth: { mode: 'bearer' | 'x-api-key' | 'custom'; headerName?: string; prefix?: string };
  responseField: string;
}
```

`parseUploadedTranscript` 先用 `TextEncoder` 检查 `2 MiB`，只接受 txt/srt/vtt，去 BOM、WEBVTT header、cue number、timestamp 和空 cue settings，最后限制 `1,000,000` 字符。`createHttpTranscriptProvider` 必须注入安全 plan 的 `SafeHttpClient`，调用固定 limits `{ timeoutMs:20_000,maxRedirects:3,maxResponseBytes:2*1024*1024,signal }`；不得直接使用全局 fetch。custom header name 必须通过 HTTP token 校验并拒绝 `Host`、`Content-Length`、`Connection`、换行符；用逐段 object lookup 读取 `responseField`，禁止 `eval`/JSONPath dependency。

- [ ] **Step 5: 实现 main config 与 D9 handler**

`TranscriptConfigStore.set` 先写 SecureStorage，再写 settings ref；`getResolved` 回读 key，缺失时返回 `TRANSCRIPT_PROVIDER_REQUIRED`。D9 顺序固定：

```ts
if (request.uploadedText && request.uploadedName) {
  transcript = parseUploadedTranscript(request.uploadedName, request.uploadedText);
} else {
  const resolved = await transcriptConfig.getResolved();
  if (!resolved.ok) return resolved;
  transcript = await createHttpTranscriptProvider(resolved.value)
    .transcribe({ url: request.url, title: meta.title }, signal);
}
```

只有拿到非空 transcript 后才调用摘要 model；不再保留 `getTranscript(): undefined`。

- [ ] **Step 6: 实现 VideoSummary 上传回退**

组件增加：

```tsx
<input
  data-testid="video-transcript-file"
  type="file"
  accept=".txt,.srt,.vtt,text/plain,text/vtt"
  onChange={async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setErrorCode('TRANSCRIPT_FILE_TOO_LARGE');
      return;
    }
    setUpload({ name: file.name, text: await file.text() });
  }}
/>
```

invoke payload 为 `{ url?: string, uploadedName?: string, uploadedText?: string }`。上传存在时 URL 可空；URL-only 且无 config 必须显示 `TRANSCRIPT_PROVIDER_REQUIRED`。

- [ ] **Step 7: 验证**

```bash
pnpm --filter @jarvis/core vitest run src/office/transcript.spec.ts src/office/video.spec.ts
pnpm --filter @jarvis/desktop vitest run src/main/office/TranscriptConfigStore.spec.ts src/main/ipc/office.spec.ts src/renderer/src/components/office/VideoSummary.spec.tsx
pnpm --filter @jarvis/core typecheck
pnpm --filter @jarvis/desktop typecheck
```

Expected: PASS；HTTP mock 和真实 File upload test 均覆盖。

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/office/transcript.ts packages/core/src/office/transcript.spec.ts packages/core/src/office/video.ts packages/core/src/office/video.spec.ts packages/core/src/office/index.ts apps/desktop/src/main/office/TranscriptConfigStore.ts apps/desktop/src/main/office/TranscriptConfigStore.spec.ts apps/desktop/src/main/ipc/office.ts apps/desktop/src/main/ipc/office.spec.ts apps/desktop/src/main/ipc/IpcRouter.ts apps/desktop/src/renderer/src/components/office/VideoSummary.tsx apps/desktop/src/renderer/src/components/office/VideoSummary.spec.tsx
git diff --cached --check
git diff --cached --name-only
git commit -m "feat: add configurable transcript provider and upload fallback"
```

---

### Task 7: D10 用户 Provider/Model capability 与无默认模型图像生成

**Files:**
- Modify: `apps/desktop/src/main/db/migrations.ts`
- Modify: `apps/desktop/src/main/db/migrations.spec.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `apps/desktop/src/main/ipc/providers.ts`
- Modify: `apps/desktop/src/main/ipc/providers.spec.ts`
- Modify: `apps/desktop/src/renderer/src/pages/settings/ProviderSettingsPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/settings/ProviderSettingsPage.spec.tsx`
- Modify: `packages/core/src/office/image.ts`
- Modify: `packages/core/src/office/image.spec.ts`
- Modify: `apps/desktop/src/main/ipc/office.ts`
- Modify: `apps/desktop/src/main/ipc/office.spec.ts`
- Modify: `apps/desktop/src/renderer/src/components/office/ImageGenerator.tsx`
- Modify: `apps/desktop/src/renderer/src/components/office/ImageGenerator.spec.tsx`

**Interfaces:**
- Produces:
  - migration v14 `models.capabilities_json`（v13 由 Engine plan 的 Agent fallback migration 占用）
  - `Model.capabilities: ModelCapability[]`
  - `ModelInput { modelId; name; capabilities }`
  - `office.image.generate({ providerId, modelId, prompt, size })`
  - `OpenAiImageDeps.model: string` required。

- [ ] **Step 1: 写 migration/provider 失败测试**

```ts
it('adds model capabilities in migration v14', () => {
  const db = new Database(':memory:');
  applyMigrations(db);
  const columns = db.prepare('PRAGMA table_info(models)').all() as Array<{ name: string }>;
  expect(columns.map((c) => c.name)).toContain('capabilities_json');
});

it('round-trips user-selected model capabilities', async () => {
  const store = createProviderStore(db, secrets);
  const provider = await store.create({ name: 'P', type: 'openai-compatible', baseUrl: 'https://images.example/v1', apiKey: 'secret' });
  const model = store.addModel(provider.id, {
    modelId: 'vendor-user-entered-image-model',
    name: 'Image model',
    capabilities: ['image-generation'],
  });
  expect(model.capabilities).toEqual(['image-generation']);
});
```

- [ ] **Step 2: 写 adapter/IPC 失败测试**

```ts
it('requires the caller-provided model and sends it unchanged', async () => {
  let body: any;
  const adapter = createOpenAiImageAdapter({
    apiKey: 'secret',
    baseUrl: 'https://images.example/v1',
    model: 'vendor-user-entered-image-model',
    fetchImpl: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ data: [{ url: 'https://img.example/1.png' }] }), { status: 200 });
    },
  });
  await adapter.generate({ prompt: 'cat' });
  expect(body.model).toBe('vendor-user-entered-image-model');
});

it('rejects missing and non-capable models before reading a key', async () => {
  const secrets = { get: vi.fn(async () => 'secret') };
  const missing = await generateImage({ providerId: 'p1', modelId: '', prompt: 'cat' }, deps);
  expect(missing).toEqual({ ok: false, error: { code: 'IMAGE_MODEL_REQUIRED' } });
  expect(secrets.get).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: 运行测试确认失败**

```bash
pnpm --filter @jarvis/desktop vitest run src/main/db/migrations.spec.ts src/main/ipc/providers.spec.ts src/main/ipc/office.spec.ts
pnpm --filter @jarvis/core vitest run src/office/image.spec.ts
```

Expected: FAIL。

- [ ] **Step 4: 追加 v14 migration 与 provider capability**

```ts
{
  version: 14,
  sql: `
    ALTER TABLE models ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '["chat"]';
  `,
}
```

`rowToModel` 必须 parse 并 allowlist `chat|vision|image-generation`；非法 DB 值回退 `['chat']`，不推断 model ID。Provider model UI 新增 capability checkbox：

```tsx
<label>
  <input
    data-testid="provider-model-image-capability"
    type="checkbox"
    checked={imageGeneration}
    onChange={(event) => setImageGeneration(event.target.checked)}
  />
  {t('settings.provider.capability.imageGeneration')}
</label>
```

新增 model 时发送用户输入 model ID 和 `imageGeneration ? ['image-generation'] : ['chat']`。

- [ ] **Step 5: 删除默认 model 并接线 main**

`OpenAiImageDeps.model` 改为 required，request body 只能使用 `deps.model`：

```ts
export interface OpenAiImageDeps {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
}
```

main SQL 必须按 provider row ID + model row ID join，并验证：

```sql
SELECT p.id AS provider_id, p.type, p.base_url, p.api_key_ref,
       m.id AS model_row_id, m.model_id, m.capabilities_json
FROM providers p
JOIN models m ON m.provider_id = p.id
WHERE p.id = ? AND m.id = ?
```

不存在 → `IMAGE_MODEL_REQUIRED`；capabilities 不含 `image-generation` → `IMAGE_MODEL_NOT_CAPABLE`；key ref 回读为空 → `IMAGE_API_KEY_MISSING`。调用 adapter 时传 `row.base_url`、`row.model_id` 和 SecureStorage key。不得读取/写入 `image.api_key_ref`。

- [ ] **Step 6: 实现 ImageGenerator 用户选择**

组件 mount 时调用 `provider.list`，再逐 provider 调 `provider.listModels`；只显示 `openai-compatible` 且 model capabilities 含 `image-generation` 的选项。选择值保存 row IDs：

```tsx
<select data-testid="image-model" value={selection} onChange={(event) => setSelection(event.target.value)}>
  <option value="">{t('officeTools.image.selectModel')}</option>
  {options.map(({ provider, model }) => (
    <option key={model.id} value={`${provider.id}:${model.id}`}>
      {provider.name} / {model.name}
    </option>
  ))}
</select>
```

generate invoke 必须为：

```ts
window.jarvis.invoke(IpcChannel.officeImageGenerate, {
  providerId,
  modelId,
  prompt: prompt.trim(),
  size,
});
```

无可用模型时显示进入 Provider settings 并标记 image capability 的双语提示，不选择任何默认 ID。

- [ ] **Step 7: 验证无硬编码 model**

```bash
pnpm --filter @jarvis/desktop vitest run src/main/db/migrations.spec.ts src/main/ipc/providers.spec.ts src/main/ipc/office.spec.ts src/renderer/src/pages/settings/ProviderSettingsPage.spec.tsx src/renderer/src/components/office/ImageGenerator.spec.tsx
pnpm --filter @jarvis/core vitest run src/office/image.spec.ts
pnpm --filter @jarvis/desktop typecheck
pnpm --filter @jarvis/core typecheck
rg "dall-e|gpt-image|image\\.api_key_ref" packages/core/src apps/desktop/src
```

Expected: tests/typecheck PASS；最后 `rg` 无匹配。

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/main/db/migrations.ts apps/desktop/src/main/db/migrations.spec.ts packages/protocol/src/index.ts apps/desktop/src/main/ipc/providers.ts apps/desktop/src/main/ipc/providers.spec.ts apps/desktop/src/renderer/src/pages/settings/ProviderSettingsPage.tsx apps/desktop/src/renderer/src/pages/settings/ProviderSettingsPage.spec.tsx packages/core/src/office/image.ts packages/core/src/office/image.spec.ts apps/desktop/src/main/ipc/office.ts apps/desktop/src/main/ipc/office.spec.ts apps/desktop/src/renderer/src/components/office/ImageGenerator.tsx apps/desktop/src/renderer/src/components/office/ImageGenerator.spec.tsx
git diff --cached --check
git diff --cached --name-only
git commit -m "feat: select user image providers and models"
```

---

### Task 8: 全 Office 稳定错误映射、双语回归与验收

**Files:**
- Create: `apps/desktop/src/renderer/src/components/office/OfficeError.tsx`
- Create: `apps/desktop/src/renderer/src/components/office/OfficeError.spec.tsx`
- Modify: `apps/desktop/src/renderer/src/components/office/VideoSummary.tsx`
- Modify: `apps/desktop/src/renderer/src/components/office/VideoSummary.spec.tsx`
- Modify: `apps/desktop/src/renderer/src/components/office/ImageGenerator.tsx`
- Modify: `apps/desktop/src/renderer/src/components/office/ImageGenerator.spec.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/PdfReaderPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/PdfReaderPage.spec.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/OfficePage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/OfficePage.spec.tsx`
- Modify: `packages/i18n/locales/zh-CN/common.json`
- Modify: `packages/i18n/locales/en/common.json`
- Modify: `apps/desktop/e2e/electron-smoke.spec.ts`

**Interfaces:**
- Consumes: Tasks 2-7 `OfficeResult<T>`。
- Produces:
  - `OfficeError({ error }): JSX.Element`
  - i18n key `officeErrors.<OfficeErrorCode>`
  - main detail 仅作为开发诊断，不直接作为用户文案。

- [ ] **Step 1: 写双语错误失败测试**

```tsx
import { render, screen } from '@testing-library/react';
import i18n from 'i18next';
import { describe, expect, it } from 'vitest';
import { OfficeError } from './OfficeError';

describe('OfficeError', () => {
  it.each([
    ['zh-CN', 'OFFICE_PARSE_TIMEOUT', '文档解析超时'],
    ['en', 'OFFICE_PARSE_TIMEOUT', 'Document parsing timed out'],
    ['zh-CN', 'IMAGE_API_KEY_MISSING', '图像 Provider 缺少 API Key'],
    ['en', 'TRANSCRIPT_PROVIDER_REQUIRED', 'Configure a transcript provider'],
  ] as const)('maps %s %s without rendering detail', async (lng, code, expected) => {
    await i18n.changeLanguage(lng);
    render(<OfficeError error={{ code, detail: '/Users/private/secret.pdf' }} />);
    expect(screen.getByRole('alert').textContent).toContain(expected);
    expect(screen.getByRole('alert').textContent).not.toContain('/Users/private');
  });
});
```

为每个组件增加测试：main 返回 `{ ok:false,error:{code} }` 时出现相应双语文案；不得再断言中文 main error 字符串。

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @jarvis/desktop vitest run src/renderer/src/components/office/OfficeError.spec.tsx src/renderer/src/components/office/VideoSummary.spec.tsx src/renderer/src/components/office/ImageGenerator.spec.tsx src/renderer/src/pages/PdfReaderPage.spec.tsx src/renderer/src/pages/OfficePage.spec.tsx
```

Expected: FAIL。

- [ ] **Step 3: 实现稳定映射**

```tsx
import type { OfficeError as OfficeErrorValue } from '@jarvis/protocol';
import { useTranslation } from 'react-i18next';

export function OfficeError({ error }: { error: OfficeErrorValue }) {
  const { t } = useTranslation('common');
  return <div role="alert" data-testid="office-error">{t(`officeErrors.${error.code}`)}</div>;
}
```

两个 locale 必须为 Task 2 的全部 code 提供同构 key；示例：

```json
"officeErrors": {
  "OFFICE_PARSE_TIMEOUT": "Document parsing timed out",
  "OFFICE_PARSE_MEMORY_LIMIT": "Document exceeded the parser memory limit",
  "TRANSCRIPT_PROVIDER_REQUIRED": "Configure a transcript provider or upload a TXT/SRT/VTT file",
  "IMAGE_MODEL_REQUIRED": "Select an image-capable model",
  "IMAGE_API_KEY_MISSING": "The image provider is missing an API key"
}
```

zh-CN 提供语义等价翻译。所有 Office renderer catch 统一把未知 rejected IPC 映射为 `OFFICE_PARSE_FAILED` 或对应能力的 `*_FAILED`，不得展示 `e.message`。main `detail` 只能包含 parser/provider 的脱敏摘要，不包含路径、URL credentials、header、API key 或文件正文。

- [ ] **Step 4: 增加 Electron 主旅程**

在 `electron-smoke.spec.ts` 使用 mock Provider 和小型测试文件覆盖：

```ts
test('office parser remains responsive and D9/D10 use user configuration', async ({ page }) => {
  await page.getByTestId('nav-office').click();
  await page.getByTestId('office-tab-video').click();
  await page.getByTestId('video-transcript-file').setInputFiles({
    name: 'sample.vtt',
    mimeType: 'text/vtt',
    buffer: Buffer.from('WEBVTT\n\n00:00.000 --> 00:01.000\nHello world'),
  });
  await page.getByTestId('video-summarize').click();
  await expect(page.getByTestId('video-result')).toContainText('mock summary');

  await page.getByTestId('office-tab-image').click();
  await page.getByTestId('image-model').selectOption({ label: 'Test Provider / User Image Model' });
  await page.getByTestId('image-prompt').fill('a local test image');
  await page.getByTestId('image-generate').click();
  await expect(page.getByTestId('image-result')).toBeVisible();
});
```

E2E seed 创建的 `User Image Model` 仅存在于测试数据库，不得进入生产 seed/config。

- [ ] **Step 5: 定向与全局验证**

```bash
pnpm --filter @jarvis/core vitest run src/office
pnpm --filter @jarvis/protocol test
pnpm --filter @jarvis/desktop vitest run src/main/office src/main/ipc/office.spec.ts src/main/ipc/providers.spec.ts src/renderer/src/components/office src/renderer/src/pages/PdfReaderPage.spec.tsx src/renderer/src/pages/OfficePage.spec.tsx
pnpm i18n:check
pnpm typecheck
pnpm test
pnpm build
pnpm audit --prod
cd apps/desktop && pnpm e2e:electron
```

Expected: 全部 PASS。Electron E2E 不依赖签名证书或外部服务，失败时本 Task 不得完成；只有原生安装、签名和公证属于可记录“外部验证待执行”的外部门禁。

- [ ] **Step 6: 静态安全验收**

```bash
cd /Users/baofengbaofeng/Workspace/github/baofengbaofeng/Jarvis
rg "\"xlsx\"|from 'xlsx'|import\\('xlsx'\\)|dall-e|image\\.api_key_ref" apps/desktop/package.json apps/desktop/src packages/core/src
rg "readFileSync|getDocument|mammoth|JSZip|ExcelJS|toString\\('base64'\\)" apps/desktop/src/main/ipc/office.ts
rg "error \\?\\?|e instanceof Error \\? e\\.message" apps/desktop/src/renderer/src/components/office apps/desktop/src/renderer/src/pages/PdfReaderPage.tsx apps/desktop/src/renderer/src/pages/OfficePage.tsx
```

Expected: 三条命令均无匹配。parser imports 只允许出现在 `apps/desktop/src/main/office/parser-worker.ts`。

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/src/components/office/OfficeError.tsx apps/desktop/src/renderer/src/components/office/OfficeError.spec.tsx apps/desktop/src/renderer/src/components/office/VideoSummary.tsx apps/desktop/src/renderer/src/components/office/VideoSummary.spec.tsx apps/desktop/src/renderer/src/components/office/ImageGenerator.tsx apps/desktop/src/renderer/src/components/office/ImageGenerator.spec.tsx apps/desktop/src/renderer/src/pages/PdfReaderPage.tsx apps/desktop/src/renderer/src/pages/PdfReaderPage.spec.tsx apps/desktop/src/renderer/src/pages/OfficePage.tsx apps/desktop/src/renderer/src/pages/OfficePage.spec.tsx packages/i18n/locales/zh-CN/common.json packages/i18n/locales/en/common.json apps/desktop/e2e/electron-smoke.spec.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "fix: localize stable office failures"
```

## Self-Review

- SEC-03: Tasks 1、3、4 删除 `xlsx@0.18.5`，在 256 MiB utility process 内解析并限制 timeout/frame/output。
- PERF-02: Tasks 2-5 覆盖文件、页数、单元格、ZIP 解压、timeout、memory；PDF 单次 parser 结果复用且不再 Base64。
- REQ-01: Task 6 完成 HTTP `TranscriptProvider` 与 txt/srt/vtt fallback，不引入本地模型。
- REQ-05: Task 7 把 D10 接入现有 Provider/Model 配置与 SecureStorage。
- STD-04: Tasks 2、8 使用稳定错误码并由 renderer 双语映射。
- STD-05: Task 7 让 model 成为必填用户配置，静态扫描阻止硬编码 ID。
- 依赖安全：Task 1 是后续所有实现的阻断门；未通过 Sonatype/许可证/CVE 不得安装。
- 类型一致：Office error、result、model capability 只在 protocol 定义；core/main/renderer 均消费相同类型。
- Placeholder scan: Task 1 的动态审计证据来自当次 Sonatype 查询，提交门禁止示例说明文字进入评估文档；其他 Task 无待定实现。

## Execution Order

严格按 Task 1 → 8 执行。Task 5 开始前必须先合入安全信任边界 plan 的 path capability 接口；该外部依赖未满足时停止，不得临时恢复裸路径 IPC。每个 Task 完成测试和独立 commit 后再进入下一 Task。
