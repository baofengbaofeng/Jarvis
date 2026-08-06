# CR Performance and Release Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close PERF-03/PERF-04, establish reproducible performance/release evidence, exercise S1–S6 in the real Electron shell, and produce an evidence-backed 44-item CR remediation matrix.

**Architecture:** Reuse one non-persistent Electron partition and erase its storage around every WebView use. Split renderer routes and heavy Markdown/Office modules at dynamic-import boundaries, then gate emitted assets with a measured, committed budget. Run performance, Electron journeys, dependency/SBOM, and native installer jobs as separate reproducible gates; signing, notarization, and provenance are explicit policy inputs whose missing credentials fail before packaging rather than being reported as successful external validation.

**Tech Stack:** Electron 32 sessions/BrowserWindow, React 19 `lazy`/`Suspense`, electron-vite/Vite manifests, Vitest, Playwright Electron, better-sqlite3, Go daemon, pnpm 9.12/Turbo, GitHub Actions, electron-builder, CycloneDX JSON, GitHub artifact attestations.

## Global Constraints

- This plan owns PERF-03 and PERF-04 and aggregates final evidence for all 44 CR IDs; fixes owned by Plans 1–6 are prerequisites, not reimplemented here.
- Electron cold start must be `<3000ms`, daemon readiness `<1000ms`, and indexed/FTS queries over a 100,000-row `chat_messages` corpus must each have p95 `<100ms`.
- Performance runs use a fresh temporary data directory, release-mode build, local daemon, fixed fixture seed, five cold-start samples, five daemon samples, five warmups, and thirty measured database queries. CI records every sample and gates the maximum cold-start/daemon sample plus database p95.
- Renderer entry and named lazy chunks use a committed post-remediation baseline generated from a clean build; no tracked budget may increase without an explicit reviewed budget-file change.
- S1–S6 use the real Electron main/preload/SQLite paths and local mock Provider/MCP/Multica services. They use no internet, real API key, account, signing identity, or production Multica server.
- `renderer` imports only `@jarvis/core/renderer`; no model ID is hardcoded in production code or seed data.
- Node unit and Electron E2E run in separate jobs/installs so rebuilding `better-sqlite3` for one ABI cannot make the other pass by test order.
- Windows MSI is built only on a Windows runner. Intel and Apple Silicon DMGs are built by two sequential builder invocations, each preceded by the matching daemon build.
- Unsigned preview artifacts are allowed only when `release_policy=preview`. `release_policy=signed` requires platform credentials, macOS hardened runtime plus notarization, Windows signing verification, and provenance attestation.
- Missing/invalid external credentials are a hard failure with a named error. The CR report records `外部验证待执行` until a real signed installer run and native install check exist; it never infers success from configuration.
- Do not modify migrations v1–v12. Do not add telemetry, cloud sync, auto-update, local models, global shortcuts, or Monaco.
- Every task stages only its listed files and ends in one independent commit.

---

## File Map

**WebView lifecycle**
- Modify `apps/desktop/src/main/webview/WebViewHost.ts`: fixed partition, injected session cleaner, serialized before/after cleanup.
- Modify `apps/desktop/src/main/webview/WebViewHost.spec.ts`: partition reuse, cleanup ordering, 100-cycle stability, failure cleanup.
- Modify `apps/desktop/src/main/ipc/office.ts` and `office.spec.ts`: await asynchronous close/cleanup.

**Lazy loading and bundle budgets**
- Modify `apps/desktop/src/renderer/src/App.tsx`: route-level lazy imports.
- Modify `apps/desktop/src/renderer/src/components/chat/MarkdownView.tsx` and its new colocated spec: lazy syntax renderer with plain-code fallback.
- Modify `apps/desktop/src/renderer/src/pages/OfficePage.tsx` and its spec: lazy Office tab modules.
- Modify `apps/desktop/electron.vite.config.ts`: renderer manifest and stable chunk naming.
- Create `scripts/bundle-budget-lib.mjs`, `scripts/bundle-budget.spec.mjs`, `scripts/check-bundle-budget.mjs`, and `bundle-budget.json`: measured asset classification and regression gate.

**Performance**
- Create `scripts/perf/run.mjs`, `scripts/perf/daemon-ready.mjs`, `scripts/perf/chat-query.mjs`, and `scripts/perf/assert-results.mjs`: deterministic measurements and threshold gate.
- Create `apps/desktop/e2e/performance.spec.ts`: release-build Electron cold-start measurement.
- Modify root/desktop `package.json`, `turbo.json`, and Playwright config: first-class scripts and uncached performance output.

**S1–S6 Electron journeys**
- Create `apps/desktop/e2e/helpers/mock-services.ts` and `journey-fixtures.ts`: local protocol fixtures and isolated workspace.
- Replace `apps/desktop/e2e/s2-file-shell.spec.ts`; create `s1-onboarding-chat.spec.ts`, `s3-office.spec.ts`, `s4-coding-diff.spec.ts`, `s5-squad.spec.ts`, and `s6-multica.spec.ts`.
- Modify `apps/desktop/e2e/helpers/electron-app.ts`, `global-setup.ts`, `playwright.config.ts`, and `tsconfig.e2e.json`: deterministic launch, logs/traces, daemon build, typed E2E.

**Supply chain and installers**
- Create `scripts/verify-audit.mjs`, `scripts/verify-sbom.mjs`, and their Node tests.
- Create `apps/desktop/electron-builder.yml`, `scripts/release/verify-artifacts.mjs`, and tests.
- Modify `apps/desktop/src/main/daemon/DaemonSupervisor.ts` and its spec for `.exe`.
- Modify root/desktop `package.json`, `pnpm-lock.yaml`, and `.gitignore`.
- Create `.github/workflows/performance-release.yml`, `build-installers.yml`, and `release-supply-chain.yml`.

**Final review**
- Create `scripts/cr-matrix-lib.mjs`, `scripts/check-cr-matrix.mjs`, and tests.
- Modify `wiki/质量报告/JARVIS CodeReview_2026-08-06.md`: append the 44-row evidence matrix and rerun conclusion.

### Task 1: Reuse and Scrub the Isolated WebView Session

**Files:**
- Modify: `apps/desktop/src/main/webview/WebViewHost.ts`
- Modify: `apps/desktop/src/main/webview/WebViewHost.spec.ts`
- Modify: `apps/desktop/src/main/ipc/office.ts`
- Modify: `apps/desktop/src/main/ipc/office.spec.ts`

**Interfaces:**
- Produces: `WEBVIEW_PARTITION = 'webview-isolated'`.
- Produces: `WebViewSessionCleaner.clear(): Promise<void>` and `WebViewHost.close(): Promise<void>`.
- Invariant: `open()` awaits cleanup before `loadURL`; `close()` closes the window and awaits cleanup; cleanup calls both `clearStorageData()` and `clearCache()`.

- [ ] **Step 1: Add failing lifecycle tests**

```ts
it('reuses one partition and scrubs before and after every use', async () => {
  const events: string[] = [];
  const partitions: string[] = [];
  const host = new WebViewHost({
    clearSession: async () => { events.push('clear'); },
    createWindow: (partition) => {
      partitions.push(partition);
      return fakeWindow({
        loadURL: async () => { events.push('load'); },
        close: () => { events.push('close'); },
      });
    },
  });

  await host.open('https://a.example');
  await host.close();
  await host.open('https://b.example');
  await host.close();

  expect(new Set(partitions)).toEqual(new Set(['webview-isolated']));
  expect(events).toEqual(['clear', 'load', 'close', 'clear', 'clear', 'load', 'close', 'clear']);
});

it('keeps one partition across 100 open-close cycles', async () => {
  const partitions: string[] = [];
  const clearSession = vi.fn(async () => {});
  const host = new WebViewHost({
    clearSession,
    createWindow: (partition) => {
      partitions.push(partition);
      return fakeWindow();
    },
  });
  for (let i = 0; i < 100; i += 1) {
    await host.open(`https://example.test/${i}`);
    await host.close();
  }
  expect(new Set(partitions).size).toBe(1);
  expect(clearSession).toHaveBeenCalledTimes(200);
});

it('closes and scrubs when extraction or summarization fails', async () => {
  const web = { open: vi.fn(), extract: vi.fn().mockRejectedValue(new Error('boom')), close: vi.fn() };
  await expect(summarizeWebPage('https://example.test', web, vi.fn())).resolves.toEqual({ ok: false, error: 'boom' });
  expect(web.close).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Verify the tests fail for unique partitions and synchronous close**

Run: `pnpm --dir apps/desktop vitest run src/main/webview/WebViewHost.spec.ts src/main/ipc/office.spec.ts`

Expected: FAIL because partitions differ and cleanup is never called/awaited.

- [ ] **Step 3: Implement the fixed session and serialized cleanup**

```ts
export const WEBVIEW_PARTITION = 'webview-isolated';

export interface WebViewHostDeps {
  createWindow?: (partition: string) => WebViewWindow;
  clearSession?: () => Promise<void>;
}

constructor(deps: WebViewHostDeps = {}) {
  const isolated = session.fromPartition(WEBVIEW_PARTITION, { cache: false });
  this.clearSession = deps.clearSession ?? (async () => {
    await isolated.clearStorageData();
    await isolated.clearCache();
  });
  this.createWindow = deps.createWindow ?? ((partition) => new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: { partition, sandbox: true, nodeIntegration: false, contextIsolation: true },
  }));
}

async open(url: string): Promise<void> {
  if (this.win) await this.close();
  else await this.clearSession();
  const win = this.createWindow(WEBVIEW_PARTITION);
  this.win = win;
  win.on('closed', () => { if (this.win === win) this.win = null; });
  try {
    await win.loadURL(url);
  } catch (error) {
    await this.close();
    throw error;
  }
}

async close(): Promise<void> {
  const win = this.win;
  this.win = null;
  win?.close();
  await this.clearSession();
}
```

Update `WebViewLike.close` and `summarizeWebPage` to return/await `Promise<void>` in `finally`.

- [ ] **Step 4: Run focused and desktop tests**

Run: `pnpm --dir apps/desktop vitest run src/main/webview/WebViewHost.spec.ts src/main/ipc/office.spec.ts`

Expected: PASS, including exactly 200 cleanup calls for 100 cycles.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/webview/WebViewHost.ts apps/desktop/src/main/webview/WebViewHost.spec.ts apps/desktop/src/main/ipc/office.ts apps/desktop/src/main/ipc/office.spec.ts
git commit -m "fix: reuse and scrub isolated webview session"
```

### Task 2: Split Markdown and Office Heavy Modules

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/components/chat/MarkdownView.tsx`
- Create: `apps/desktop/src/renderer/src/components/chat/MarkdownCodeBlock.tsx`
- Create: `apps/desktop/src/renderer/src/components/chat/MarkdownView.spec.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/OfficePage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/OfficePage.spec.tsx`
- Modify: `apps/desktop/electron.vite.config.ts`

**Interfaces:**
- Produces: route chunks for `office`, `coding`, `squad`, `workflow`, `canvas`, and settings.
- Produces: `MarkdownCodeBlock` loaded only for fenced code with a language.
- Invariant: plain Markdown and initial Office writing UI do not evaluate Prism, PDF, image, video, search, or global-search modules.

- [ ] **Step 1: Add lazy-boundary tests**

```tsx
vi.mock('./MarkdownCodeBlock', () => ({
  MarkdownCodeBlock: ({ children }: { children: string }) => <pre data-testid="highlighted">{children}</pre>,
}));

it('renders plain markdown without requesting the highlighter chunk', () => {
  render(<MarkdownView content="plain **text**" />);
  expect(screen.getByText('text')).toBeVisible();
  expect(screen.queryByTestId('highlighted')).toBeNull();
});

it('loads the highlighter only for a fenced language block', async () => {
  render(<MarkdownView content={'```ts\nconst n = 1\n```'} />);
  expect(await screen.findByTestId('highlighted')).toHaveTextContent('const n = 1');
});
```

Add an Office test that renders the writing tab, asserts `office-tab-writing` is visible, clicks `office-tab-image`, and waits for the mocked `ImageGenerator`; no heavy-tab mock may render before its click.

- [ ] **Step 2: Verify focused tests fail**

Run: `pnpm --dir apps/desktop vitest run src/renderer/src/components/chat/MarkdownView.spec.tsx src/renderer/src/pages/OfficePage.spec.tsx`

Expected: FAIL because syntax highlighting and most Office tools are statically imported.

- [ ] **Step 3: Implement dynamic boundaries**

```tsx
const MarkdownCodeBlock = lazy(() =>
  import('./MarkdownCodeBlock').then(({ MarkdownCodeBlock }) => ({ default: MarkdownCodeBlock })),
);

code({ className, children, node: _node, ...props }) {
  const language = /language-([\w-]+)/.exec(className ?? '')?.[1];
  if (!language) return <code className={className} {...props}>{children}</code>;
  return (
    <Suspense fallback={<pre><code className={className}>{children}</code></pre>}>
      <MarkdownCodeBlock language={language}>{String(children)}</MarkdownCodeBlock>
    </Suspense>
  );
}
```

`MarkdownCodeBlock.tsx` owns the only imports of `react-syntax-highlighter` and `oneDark`. Convert Office tabs other than the initial writing shell to `lazy(() => import(...))`, and convert top-level routes in `App.tsx` to lazy imports. Keep `SelectionMenu`, approval, toast, theme, and the chat route eager because they are app-shell behavior.

- [ ] **Step 4: Build and inspect emitted chunks**

Run: `pnpm --dir apps/desktop build`

Expected: PASS; `out/renderer/assets` contains separate Markdown highlighter, Office, PDF, coding, squad, and settings JavaScript chunks.

- [ ] **Step 5: Run renderer tests**

Run: `pnpm --dir apps/desktop vitest run src/renderer/src/components/chat/MarkdownView.spec.tsx src/renderer/src/pages/OfficePage.spec.tsx src/renderer/src/App.spec.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/components/chat/MarkdownView.tsx apps/desktop/src/renderer/src/components/chat/MarkdownCodeBlock.tsx apps/desktop/src/renderer/src/components/chat/MarkdownView.spec.tsx apps/desktop/src/renderer/src/pages/OfficePage.tsx apps/desktop/src/renderer/src/pages/OfficePage.spec.tsx apps/desktop/electron.vite.config.ts
git commit -m "perf: lazy load markdown and office modules"
```

### Task 3: Enforce a Measured Renderer Bundle Budget

**Files:**
- Create: `scripts/bundle-budget-lib.mjs`
- Create: `scripts/bundle-budget.spec.mjs`
- Create: `scripts/check-bundle-budget.mjs`
- Create: `bundle-budget.json`
- Modify: `apps/desktop/electron.vite.config.ts`
- Modify: `package.json`
- Modify: `turbo.json`

**Interfaces:**
- Produces: `classifyAssets(manifest, assetDir): Record<string, number>`.
- CLI: `node scripts/check-bundle-budget.mjs --capture bundle-budget.json` writes actual byte limits after Task 2; no rounded or report-copied values.
- CLI: `node scripts/check-bundle-budget.mjs --check bundle-budget.json` exits 1 for missing classifications or any byte regression.

- [ ] **Step 1: Write the budget library test**

```js
test('fails when an emitted entry exceeds its committed byte budget', () => {
  const result = compareBudget(
    { rendererEntry: 101, markdownHighlighter: 40, pdfWorker: 80 },
    { rendererEntry: 100, markdownHighlighter: 40, pdfWorker: 80 },
  );
  assert.deepEqual(result, ['rendererEntry: 101 > 100 bytes']);
});

test('fails closed when a tracked asset disappears from classification', () => {
  assert.deepEqual(compareBudget({ rendererEntry: 99 }, { rendererEntry: 100, pdfWorker: 80 }), [
    'pdfWorker: asset classification missing',
  ]);
});
```

- [ ] **Step 2: Run the Node test and verify failure**

Run: `node --test scripts/bundle-budget.spec.mjs`

Expected: FAIL because the library does not exist.

- [ ] **Step 3: Implement manifest classification and comparison**

```js
export function compareBudget(actual, budget) {
  return Object.entries(budget).flatMap(([name, limit]) => {
    if (!(name in actual)) return [`${name}: asset classification missing`];
    return actual[name] > limit ? [`${name}: ${actual[name]} > ${limit} bytes`] : [];
  });
}

export function classifyAssets(manifest, sizes) {
  const entries = Object.values(manifest);
  const sum = (predicate) => entries
    .filter(predicate)
    .reduce((total, item) => total + (sizes[item.file] ?? 0), 0);
  return {
    rendererEntry: sum((item) => item.isEntry === true),
    markdownHighlighter: sum((item) => /MarkdownCodeBlock/.test(item.name ?? item.src ?? '')),
    office: sum((item) => /OfficePage/.test(item.name ?? item.src ?? '')),
    pdf: sum((item) => /PdfReaderPage|pdf\.worker/.test(item.name ?? item.src ?? '')),
  };
}
```

Configure Vite `build.manifest: true`; the CLI reads `out/renderer/.vite/manifest.json`, stats every referenced asset, prints JSON, and writes only when `--capture` is explicitly supplied.

- [ ] **Step 4: Capture the clean post-remediation baseline and immediately enforce it**

Run:

```bash
pnpm --dir apps/desktop build
node scripts/check-bundle-budget.mjs --capture bundle-budget.json
node scripts/check-bundle-budget.mjs --check bundle-budget.json
```

Expected: both commands PASS. Inspect the generated JSON and confirm every value came from the current output rather than the CR report. Add root script `"bundle:check": "pnpm --dir apps/desktop build && node scripts/check-bundle-budget.mjs --check bundle-budget.json"` and Turbo task output `apps/desktop/out/**`.

- [ ] **Step 5: Prove the gate rejects a one-byte regression**

Run: `node scripts/check-bundle-budget.mjs --check bundle-budget.json --test-overage rendererEntry:1`

Expected: exit 1 with `rendererEntry` and actual/limit bytes.

- [ ] **Step 6: Commit**

```bash
git add scripts/bundle-budget-lib.mjs scripts/bundle-budget.spec.mjs scripts/check-bundle-budget.mjs bundle-budget.json apps/desktop/electron.vite.config.ts package.json turbo.json
git commit -m "test: enforce renderer bundle budgets"
```

### Task 4: Add Reproducible Performance Gates

**Files:**
- Create: `scripts/perf/daemon-ready.mjs`
- Create: `scripts/perf/chat-query.mjs`
- Create: `scripts/perf/assert-results.mjs`
- Create: `scripts/perf/run.mjs`
- Create: `scripts/perf/assert-results.spec.mjs`
- Create: `apps/desktop/e2e/performance.spec.ts`
- Modify: `apps/desktop/e2e/helpers/electron-app.ts`
- Modify: `apps/desktop/playwright.config.ts`
- Modify: root and desktop `package.json`
- Create: `.github/workflows/performance-release.yml`

**Interfaces:**
- `performance.spec.ts` writes `{ samplesMs: number[] }` to `artifacts/perf/cold-start.json`; each sample is process-launch start to first real renderer window `domcontentloaded`.
- `daemon-ready.mjs` writes launch-to-first-HTTP-200 `/health` samples and kills each child.
- `chat-query.mjs` creates a temporary migrated DB with exactly 100,000 messages, verifies `idx_chat_messages_session`, measures indexed session query and trigram FTS MATCH p95.
- `assert-results.mjs` gates cold-start max `<3000`, daemon max `<1000`, both DB p95 `<100`.

- [ ] **Step 1: Write threshold tests**

```js
test('uses strict thresholds and reports the failing metric', () => {
  assert.deepEqual(assertPerformance({
    coldStartMs: [2900, 3000],
    daemonReadyMs: [999],
    sessionQueryP95Ms: 99,
    ftsQueryP95Ms: 100,
  }), [
    'coldStart max 3000ms must be < 3000ms',
    'ftsQuery p95 100ms must be < 100ms',
  ]);
});
```

- [ ] **Step 2: Verify the threshold test fails**

Run: `node --test scripts/perf/assert-results.spec.mjs`

Expected: FAIL because `assertPerformance` does not exist.

- [ ] **Step 3: Implement the database benchmark**

```js
const sessionInsert = db.prepare('INSERT INTO chat_sessions VALUES (?, ?, ?, ?)');
const messageInsert = db.prepare(
  'INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
);
db.transaction(() => {
  for (let session = 0; session < 1000; session += 1) {
    const sessionId = `session-${session}`;
    sessionInsert.run(sessionId, sessionId, epoch, epoch);
    for (let message = 0; message < 100; message += 1) {
      messageInsert.run(`${sessionId}-${message}`, sessionId, 'user', `性能基准 needle-${message} 内容`, `${epoch}-${String(message).padStart(3, '0')}`);
    }
  }
})();
assert.equal(db.prepare('SELECT count(*) AS n FROM chat_messages').get().n, 100000);
const plan = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM chat_messages WHERE session_id=? ORDER BY created_at LIMIT 200').all('session-500');
assert.match(JSON.stringify(plan), /idx_chat_messages_session/);
```

Use five warmups and thirty `performance.now()` samples for both the indexed query and `SELECT rowid FROM chat_messages_fts WHERE chat_messages_fts MATCH ? LIMIT 50`; sort and choose `ceil(0.95*n)-1`.

- [ ] **Step 4: Implement daemon and Electron measurements**

`daemon-ready.mjs` allocates a free loopback port, spawns `resources/daemon/jarvis-daemon`, polls `/health` every 10ms with a 5s safety timeout, records the first 200 response, and terminates/reaps the child in `finally`. `performance.spec.ts` launches the release build five times with fresh `JARVIS_DATA_DIR`, starts timing immediately before `electron.launch`, waits for the first window `domcontentloaded`, records elapsed time, closes the app, and removes the directory.

- [ ] **Step 5: Add one aggregate command**

```json
{
  "scripts": {
    "perf": "pnpm --dir apps/desktop build && pnpm --dir apps/desktop build:daemon && node scripts/perf/run.mjs",
    "perf:assert": "node scripts/perf/assert-results.mjs artifacts/perf"
  }
}
```

`run.mjs` removes only `artifacts/perf`, runs the Electron project `performance.spec.ts`, then daemon and DB scripts, then the assertion script. It writes `summary.json` including Node/Electron/OS/CPU metadata and all raw samples.

- [ ] **Step 6: Run locally and preserve truthful evidence**

Run: `pnpm perf`

Expected: PASS only if all three strict thresholds are met. If the host exceeds a threshold, keep the measured JSON, leave the command failed, optimize the measured path in a new reviewed task, and do not raise the threshold.

- [ ] **Step 7: Add the CI job**

The workflow uses `macos-13`, Node `20.11.1`, pnpm `9.12.0`, Go from `daemon/go.mod`, `pnpm install --frozen-lockfile`, `pnpm perf`, and `actions/upload-artifact@v4` with `artifacts/perf/**` and `if: always()`. No cache restores performance output.

- [ ] **Step 8: Commit**

```bash
git add scripts/perf apps/desktop/e2e/performance.spec.ts apps/desktop/e2e/helpers/electron-app.ts apps/desktop/playwright.config.ts package.json apps/desktop/package.json .github/workflows/performance-release.yml
git commit -m "test: gate cold start daemon and query performance"
```

### Task 5: Build Local Protocol Fixtures for S1–S6

**Files:**
- Create: `apps/desktop/e2e/helpers/mock-services.ts`
- Create: `apps/desktop/e2e/helpers/journey-fixtures.ts`
- Modify: `apps/desktop/e2e/helpers/electron-app.ts`
- Modify: `apps/desktop/e2e/global-setup.ts`
- Modify: `apps/desktop/playwright.config.ts`
- Create or modify: `apps/desktop/tsconfig.e2e.json`

**Interfaces:**
- Produces: `startMockOpenAI(script): Promise<{ baseUrl; requests; close }>` using `127.0.0.1`.
- Produces: `startMockMcp()` and `startMockMultica()` with recorded request/event arrays.
- Produces: a Playwright `journey` fixture containing isolated app/data/workspace/services and unconditional cleanup.

- [ ] **Step 1: Write a real HTTP fixture test**

```ts
test('mock provider records a two-turn tool exchange', async () => {
  const provider = await startMockOpenAI([
    { tool: { id: 'call-1', name: 'write_file', arguments: { path: 'done.txt', content: 'done' } } },
    { text: 'task complete' },
  ]);
  try {
    const first = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'fixture-model', messages: [{ role: 'user', content: 'work' }] }),
    });
    expect(first.status).toBe(200);
    expect(provider.requests).toHaveLength(1);
  } finally {
    await provider.close();
  }
});
```

- [ ] **Step 2: Run and observe failure**

Run: `pnpm --dir apps/desktop playwright test e2e/helpers/mock-services.spec.ts --project=renderer`

Expected: FAIL because fixture helpers do not exist.

- [ ] **Step 3: Implement local-only services**

```ts
export async function listenLocal(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture server did not bind TCP');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
```

OpenAI responses must be valid non-stream/stream payloads used by the production adapter; MCP must perform initialize/list/call framing; Multica must expose register/heartbeat/claim/result streaming and record ordered chunks. Fixed responses live in the test, not production seed data.

- [ ] **Step 4: Make launch diagnostics deterministic**

`launchJarvisElectron` accepts `extraEnv`, records child stdout/stderr to `test-results/<test>/electron.log`, and throws a launch error containing both streams. Global setup builds Electron and the daemon once. Playwright uses `trace: 'retain-on-failure'`, `screenshot: 'only-on-failure'`, `video: 'retain-on-failure'`, one Electron worker, and retries `0`.

- [ ] **Step 5: Typecheck and run fixture tests**

Run:

```bash
pnpm --dir apps/desktop typecheck:e2e
pnpm --dir apps/desktop playwright test e2e/helpers/mock-services.spec.ts --project=renderer
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/e2e/helpers/mock-services.ts apps/desktop/e2e/helpers/mock-services.spec.ts apps/desktop/e2e/helpers/journey-fixtures.ts apps/desktop/e2e/helpers/electron-app.ts apps/desktop/e2e/global-setup.ts apps/desktop/playwright.config.ts apps/desktop/tsconfig.e2e.json apps/desktop/package.json
git commit -m "test: add local electron journey fixtures"
```

### Task 6: Gate the S1–S6 Real Electron Journeys

**Files:**
- Create: `apps/desktop/e2e/s1-onboarding-chat.spec.ts`
- Replace: `apps/desktop/e2e/s2-file-shell.spec.ts`
- Create: `apps/desktop/e2e/s3-office.spec.ts`
- Create: `apps/desktop/e2e/s4-coding-diff.spec.ts`
- Create: `apps/desktop/e2e/s5-squad.spec.ts`
- Create: `apps/desktop/e2e/s6-multica.spec.ts`
- Modify: `apps/desktop/playwright.config.ts`
- Modify: `apps/desktop/package.json`

**Interfaces:**
- Consumes: Task 5 `journey` fixture.
- Produces: six independent, named release gates with UI, durable-state, protocol, and side-effect assertions.

- [ ] **Step 1: Implement S1 and S2 with observable outcomes**

```ts
test('S1: onboard, configure provider, create agent, and persist a reply', async ({ journey }) => {
  const { window, provider, relaunch } = journey;
  await completeOnboarding(window);
  await configureProviderThroughUi(window, provider.baseUrl, 'fixture-secret');
  await createAgentThroughUi(window, 'Journey Agent', 'fixture-model');
  await window.getByTestId('chat-input').fill('hello');
  await window.getByTestId('chat-send').click();
  await expect(window.getByText('fixture reply')).toBeVisible();
  const reopened = await relaunch();
  await expect(reopened.getByText('fixture reply')).toBeVisible();
  expect(provider.requests).toHaveLength(1);
});

test('S2: agent writes a workspace file, runs shell, and completes task', async ({ journey }) => {
  await journey.seedAgentAndWorkspace();
  journey.provider.queueTool('write_file', { path: 'done.txt', content: 'created by S2' });
  journey.provider.queueTool('run_shell', { command: 'wc -c done.txt' });
  journey.provider.queueText('task complete');
  await journey.submitTask('create done.txt and count bytes');
  await expect(journey.window.getByTestId('task-status')).toHaveText(/completed/i);
  expect(await fs.readFile(path.join(journey.workspace, 'done.txt'), 'utf8')).toBe('created by S2');
  expect(journey.provider.requests.at(-1)?.messages).toContainEqual(expect.objectContaining({ role: 'tool' }));
});
```

- [ ] **Step 2: Implement S3–S6 with no UI-only assertions**

S3 selects text and asserts translated output, runs writing, opens a fixture PDF, and asserts extracted page text. S4 attaches a real temp source file, submits a coding task, asserts a non-empty diff, clicks Accept, and reads the changed file from disk. S5 creates Leader plus two members, delegates to both, asserts persisted `agent_messages` and completed call edges, then approves the review. S6 starts local mock Multica, waits for registration/heartbeat, queues one task, asserts `jarvis-agent` claims it and receives at least one ordered delta followed by one terminal result.

Core assertions:

```ts
expect(await fs.readFile(sourcePath, 'utf8')).toContain('accepted-change');
expect(await journey.db.scalar('SELECT count(*) FROM agent_messages WHERE squad_id=?', squadId)).toBeGreaterThanOrEqual(2);
expect(multica.events.map((event) => event.kind)).toEqual(expect.arrayContaining(['register', 'heartbeat', 'claim', 'delta', 'completed']));
expect(multica.events.findIndex(e => e.kind === 'delta')).toBeLessThan(multica.events.findIndex(e => e.kind === 'completed'));
```

- [ ] **Step 3: Remove the恒真 S2 test and configure only real-shell specs**

Set the Electron project test match to `s[1-6]-*.spec.ts` plus existing security smoke specs. The renderer project must not include S1–S6.

- [ ] **Step 4: Run each journey independently**

Run:

```bash
pnpm --dir apps/desktop e2e:electron --grep "^S1:"
pnpm --dir apps/desktop e2e:electron --grep "^S2:"
pnpm --dir apps/desktop e2e:electron --grep "^S3:"
pnpm --dir apps/desktop e2e:electron --grep "^S4:"
pnpm --dir apps/desktop e2e:electron --grep "^S5:"
pnpm --dir apps/desktop e2e:electron --grep "^S6:"
```

Expected: each command PASS alone from a clean temporary data directory.

- [ ] **Step 5: Run the aggregate release journey**

Run: `pnpm --dir apps/desktop e2e:electron`

Expected: PASS with no skipped S1–S6 test and no external network request.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/e2e/s1-onboarding-chat.spec.ts apps/desktop/e2e/s2-file-shell.spec.ts apps/desktop/e2e/s3-office.spec.ts apps/desktop/e2e/s4-coding-diff.spec.ts apps/desktop/e2e/s5-squad.spec.ts apps/desktop/e2e/s6-multica.spec.ts apps/desktop/playwright.config.ts apps/desktop/package.json
git commit -m "test: gate all six electron journeys"
```

### Task 7: Gate Dependency Audit and CycloneDX SBOM

**Files:**
- Create: `scripts/verify-audit.mjs`
- Create: `scripts/verify-audit.spec.mjs`
- Create: `scripts/verify-sbom.mjs`
- Create: `scripts/verify-sbom.spec.mjs`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `.github/workflows/release-supply-chain.yml`

**Interfaces:**
- `verify-audit.mjs` accepts pnpm audit JSON and exits 1 for any reachable production `high`/`critical`; reviewed exceptions require advisory ID, package, reachability rationale, owner, and ISO expiry.
- `verify-sbom.mjs` accepts CycloneDX JSON and requires metadata component, serial number, lockfile components, hashes, licenses, and no plaintext secret patterns.

- [ ] **Step 1: Add parser tests with vulnerable and expired fixtures**

```js
test('blocks a reachable high advisory', () => {
  const errors = verifyAudit(highAuditFixture, []);
  assert.deepEqual(errors, ['GHSA-test in xlsx is high and has no active exception']);
});

test('blocks expired exceptions', () => {
  const errors = verifyAudit(highAuditFixture, [{
    advisory: 'GHSA-test', package: 'xlsx', reason: 'unreachable parser path',
    owner: 'release', expires: '2026-08-05',
  }], new Date('2026-08-06T00:00:00Z'));
  assert.match(errors[0], /expired/);
});
```

- [ ] **Step 2: Verify tests fail, then implement fail-closed parsers**

Run: `node --test scripts/verify-audit.spec.mjs scripts/verify-sbom.spec.mjs`

Expected before implementation: FAIL; after implementation: PASS.

- [ ] **Step 3: Install the SBOM generator through pnpm**

Run: `pnpm add -Dw @cyclonedx/cyclonedx-npm`

Before accepting the lockfile, run the repository dependency-check workflow for this package, confirm no high/critical advisory and a permissive license, and record the resolved version from `pnpm-lock.yaml`; do not handwrite a version.

- [ ] **Step 4: Add exact supply-chain scripts**

```json
{
  "scripts": {
    "audit:prod": "pnpm audit --prod --json > artifacts/supply-chain/pnpm-audit.json && node scripts/verify-audit.mjs artifacts/supply-chain/pnpm-audit.json security/audit-exceptions.json",
    "sbom": "mkdir -p artifacts/supply-chain && cyclonedx-npm --output-format JSON --output-file artifacts/supply-chain/sbom.cdx.json && node scripts/verify-sbom.mjs artifacts/supply-chain/sbom.cdx.json"
  }
}
```

If no exceptions are required, commit `security/audit-exceptions.json` as `[]`.

- [ ] **Step 5: Add and run the workflow**

The workflow performs frozen install, `pnpm audit:prod`, `pnpm sbom`, and uploads audit JSON plus `sbom.cdx.json` with `if: always()`. Run locally: `pnpm audit:prod && pnpm sbom`.

Expected: PASS only with zero unexcepted reachable high/critical advisories and a structurally valid secret-free SBOM.

- [ ] **Step 6: Commit**

```bash
git add scripts/verify-audit.mjs scripts/verify-audit.spec.mjs scripts/verify-sbom.mjs scripts/verify-sbom.spec.mjs security/audit-exceptions.json package.json pnpm-lock.yaml .github/workflows/release-supply-chain.yml
git commit -m "chore: gate audit and cyclonedx sbom"
```

### Task 8: Build MSI and Dual-DMG Release Workflows with Explicit Trust Gates

**Files:**
- Create: `apps/desktop/electron-builder.yml`
- Modify: `apps/desktop/src/main/daemon/DaemonSupervisor.ts`
- Modify: `apps/desktop/src/main/daemon/DaemonSupervisor.spec.ts`
- Modify: `apps/desktop/package.json`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.gitignore`
- Create: `scripts/release/verify-artifacts.mjs`
- Create: `scripts/release/verify-artifacts.spec.mjs`
- Create: `.github/workflows/build-installers.yml`

**Interfaces:**
- Produces: `Jarvis_<version>_Preview_x86.msi`, `Jarvis_<version>_Preview_x64.dmg`, `Jarvis_<version>_Preview_arm64.dmg`, matching `.sha256`, SBOM, and provenance for uploaded artifacts.
- Input: `release_policy` enum `preview|signed`; tag builds always resolve to `signed`.
- Failure codes: `MISSING_WINDOWS_SIGNING_CREDENTIALS`, `MISSING_APPLE_SIGNING_CREDENTIALS`, `WINDOWS_SIGNATURE_INVALID`, `MACOS_NOTARIZATION_FAILED`, `PROVENANCE_ATTESTATION_FAILED`.

- [ ] **Step 1: Test platform daemon naming and artifact validation**

```ts
it.each([
  ['win32', 'jarvis-daemon.exe'],
  ['darwin', 'jarvis-daemon'],
  ['linux', 'jarvis-daemon'],
])('uses the packaged daemon name on %s', (platform, expected) => {
  expect(daemonBinaryName(platform as NodeJS.Platform)).toBe(expected);
});
```

```js
test('signed policy rejects an unsigned artifact set', async () => {
  const errors = await verifyArtifacts(unsignedFixtureDir, { policy: 'signed', platform: 'darwin' });
  assert.deepEqual(errors, ['macOS signature/notarization evidence missing']);
});
```

- [ ] **Step 2: Verify focused tests fail**

Run:

```bash
pnpm --dir apps/desktop vitest run src/main/daemon/DaemonSupervisor.spec.ts
node --test scripts/release/verify-artifacts.spec.mjs
```

Expected: FAIL because `.exe` naming and verifier do not exist.

- [ ] **Step 3: Add packager and daemon scripts**

Run: `pnpm add -D --filter @jarvis/desktop electron-builder`

Use the package-manager-resolved version and inspect its audit/license result before accepting the lockfile. Add:

```json
{
  "build:daemon:win": "cd ../../daemon && GOOS=windows GOARCH=amd64 go build -trimpath -o ../apps/desktop/resources/daemon/jarvis-daemon.exe ./cmd/jarvis-daemon",
  "build:daemon:darwin:x64": "cd ../../daemon && GOOS=darwin GOARCH=amd64 go build -trimpath -o ../apps/desktop/resources/daemon/jarvis-daemon ./cmd/jarvis-daemon",
  "build:daemon:darwin:arm64": "cd ../../daemon && GOOS=darwin GOARCH=arm64 go build -trimpath -o ../apps/desktop/resources/daemon/jarvis-daemon ./cmd/jarvis-daemon",
  "package:win": "electron-builder --win msi --x64",
  "package:mac:x64": "electron-builder --mac dmg --x64",
  "package:mac:arm64": "electron-builder --mac dmg --arm64"
}
```

Builder config uses `asar: true`, `files: [out/**, resources/**, package.json]`, output `../../dist`, MSI x64, and separate DMG targets. Preview policy sets `CSC_IDENTITY_AUTO_DISCOVERY=false`; signed policy never sets `identity: null`.

- [ ] **Step 4: Implement preflight credential semantics**

Windows signed preflight:

```powershell
if ($env:RELEASE_POLICY -eq "signed" -and
    ([string]::IsNullOrWhiteSpace($env:WINDOWS_CERTIFICATE_BASE64) -or
     [string]::IsNullOrWhiteSpace($env:WINDOWS_CERTIFICATE_PASSWORD))) {
  Write-Error "MISSING_WINDOWS_SIGNING_CREDENTIALS"
  exit 1
}
```

macOS signed preflight requires `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`; missing any value emits `MISSING_APPLE_SIGNING_CREDENTIALS` and exits 1 before building. After build, signed mode runs `codesign --verify --deep --strict`, `xcrun notarytool submit ... --wait`, and `xcrun stapler validate`; preview mode records `externalValidation: "外部验证待执行"` in artifact metadata.

- [ ] **Step 5: Implement native jobs and architecture checks**

`windows-msi` runs on `windows-latest`; `macos-dmg` runs on `macos-13` and executes x64 daemon/build/checksum first, deletes only the shared daemon binary, then executes arm64 daemon/build/checksum. Before each builder call run `electron-builder install-app-deps`. Extract each artifact to a temp directory and verify daemon presence; on macOS run `file` and require `x86_64`/`arm64` matching the artifact. Windows runs `Get-AuthenticodeSignature` in signed mode and requires `Status -eq 'Valid'`.

- [ ] **Step 6: Add provenance and checksum verification**

Grant workflow `id-token: write`, `contents: read`, `attestations: write`. After checksums and SBOM are final, call `actions/attest-build-provenance` for each installer and SBOM. `verify-artifacts.mjs` independently recomputes SHA-256, checks exact GNU two-space format, expected names, daemon architecture, and policy evidence before upload.

- [ ] **Step 7: Run local configuration tests without claiming external validation**

Run:

```bash
pnpm --dir apps/desktop vitest run src/main/daemon/DaemonSupervisor.spec.ts
node --test scripts/release/verify-artifacts.spec.mjs
pnpm --dir apps/desktop typecheck
```

Expected: PASS. Do not mark signing, notarization, Windows installation, or provenance as externally verified from these local tests.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/electron-builder.yml apps/desktop/src/main/daemon/DaemonSupervisor.ts apps/desktop/src/main/daemon/DaemonSupervisor.spec.ts apps/desktop/package.json package.json pnpm-lock.yaml .gitignore scripts/release/verify-artifacts.mjs scripts/release/verify-artifacts.spec.mjs .github/workflows/build-installers.yml
git commit -m "feat: gate native installer release workflows"
```

### Task 9: Produce the 44-Item Remediation Matrix and Rerun Review

**Files:**
- Create: `scripts/cr-matrix-lib.mjs`
- Create: `scripts/cr-matrix-lib.spec.mjs`
- Create: `scripts/check-cr-matrix.mjs`
- Modify: `wiki/质量报告/JARVIS CodeReview_2026-08-06.md`
- Modify: `package.json`

**Interfaces:**
- Matrix columns: `CR ID | Owner plan/task | Fix commit | Regression test | Verification command | Result/evidence | Review status`.
- Allowed statuses: `Fixed`, `Not fixed`, `外部验证待执行`.
- `Fixed` requires a 40-hex commit reachable from `HEAD`, a non-empty test path, an exact command with exit code 0 in the review evidence bundle, and no external-only claim.

- [ ] **Step 1: Write completeness and truthfulness tests**

```js
test('requires every canonical CR id exactly once', () => {
  const rows = parseMatrix(reportWithRows(['PERF-03', 'PERF-03']));
  const errors = validateMatrix(rows, CANONICAL_CR_IDS);
  assert.match(errors.join('\n'), /duplicate PERF-03/);
  assert.match(errors.join('\n'), /missing PERF-04/);
});

test('does not allow Fixed without commit test command and passing evidence', () => {
  const errors = validateRow({
    id: 'PERF-03', status: 'Fixed', commit: '', test: '', command: 'pnpm test', result: 'not run',
  });
  assert.equal(errors.length, 3);
});
```

`CANONICAL_CR_IDS` contains exactly the 44 headings discovered from the original report: STD-01..05, DOC-01, PERF-01..04, SEC-01..09, BP-01..07, TEST-01..04, REQ-01..08, and MAINT-01..06.

- [ ] **Step 2: Implement and run the matrix validator**

Run: `node --test scripts/cr-matrix-lib.spec.mjs`

Expected before implementation: FAIL. Implement Markdown row parsing, duplicate/missing checks, Git reachability through `git merge-base --is-ancestor`, path existence, and evidence-result validation; then rerun and expect PASS.

- [ ] **Step 3: Execute the complete review scope and save raw logs**

```bash
mkdir -p artifacts/cr-review
pnpm lint 2>&1 | tee artifacts/cr-review/lint.log
pnpm format:check 2>&1 | tee artifacts/cr-review/format.log
pnpm typecheck 2>&1 | tee artifacts/cr-review/typecheck.log
pnpm test 2>&1 | tee artifacts/cr-review/unit.log
pnpm coverage 2>&1 | tee artifacts/cr-review/coverage.log
pnpm i18n:check 2>&1 | tee artifacts/cr-review/i18n.log
pnpm build 2>&1 | tee artifacts/cr-review/build.log
pnpm bundle:check 2>&1 | tee artifacts/cr-review/bundle.log
(cd daemon && go test ./... && go test -race ./...) 2>&1 | tee artifacts/cr-review/go.log
pnpm --dir apps/desktop e2e:electron 2>&1 | tee artifacts/cr-review/e2e.log
pnpm perf 2>&1 | tee artifacts/cr-review/perf.log
pnpm audit:prod 2>&1 | tee artifacts/cr-review/audit.log
pnpm sbom 2>&1 | tee artifacts/cr-review/sbom.log
```

Run commands separately when collecting exit codes; piping must use `set -o pipefail` so a failed producer remains failed. A failing command keeps affected rows `Not fixed`.

- [ ] **Step 4: Append all 44 rows and a fresh review conclusion**

Populate each row with the actual commit hash from Plans 1–7, exact regression path, exact command, and evidence log/result. For signed MSI/DMG install checks, notarization, and provenance, use `外部验证待执行` until the corresponding real GitHub run URL plus native-machine verification exists. Re-review the original attack chains, business paths, tests, performance, and release outputs; the conclusion is `可合入` only when all non-external rows are `Fixed` and release policy allows the remaining external state.

- [ ] **Step 5: Validate the report and run final acceptance**

Run:

```bash
node scripts/check-cr-matrix.mjs wiki/质量报告/JARVIS\ CodeReview_2026-08-06.md
pnpm test:all
pnpm bundle:check
pnpm perf
pnpm audit:prod
pnpm sbom
```

Expected: matrix command reports `44 unique CR IDs`; all executable gates PASS. External gates remain explicitly named rather than converted to PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/cr-matrix-lib.mjs scripts/cr-matrix-lib.spec.mjs scripts/check-cr-matrix.mjs wiki/质量报告/JARVIS\ CodeReview_2026-08-06.md package.json
git commit -m "docs: record final code review remediation evidence"
```

## Cross-Task Acceptance

Execute from the repository root in a clean checkout:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm coverage
pnpm i18n:check
pnpm build
pnpm bundle:check
(cd daemon && go test ./... && go test -race ./...)
pnpm --dir apps/desktop e2e:electron
pnpm perf
pnpm audit:prod
pnpm sbom
node scripts/check-cr-matrix.mjs wiki/质量报告/JARVIS\ CodeReview_2026-08-06.md
```

Required evidence:
- WebView test proves one partition and 200 scrub operations across 100 open/close cycles.
- Bundle report is generated from current Vite manifest and stays within committed post-remediation byte values.
- Performance summary contains five cold-start samples `<3000ms`, five daemon samples `<1000ms`, exactly 100,000 seeded messages, and indexed/FTS p95 `<100ms`.
- S1–S6 pass independently and together in the Electron project with local fixtures and no skipped scenario.
- Production audit has no unexcepted reachable high/critical advisory; SBOM validates and is uploaded.
- Preview installer workflow may produce unsigned artifacts with explicit preview metadata. Signed workflow cannot start packaging without credentials and cannot upload until signature/notarization/provenance verification succeeds.
- CR report contains each of the 44 IDs exactly once and never marks an unexecuted external check `Fixed`.

## Execution Order

Tasks 1–4 close PERF-03/PERF-04 and must land before measuring the final baseline. Tasks 5–6 require the functional fixes and E2E ABI baseline from Plans 1–6. Task 7 can run after dependency fixes from the Office plan. Task 8 requires the final daemon/runtime layout. Task 9 runs only after all seven plans and all prior tasks have committed evidence.
