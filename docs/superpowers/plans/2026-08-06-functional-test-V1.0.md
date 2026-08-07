# Functional Test Suite V1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a runnable Electron+IPC functional regression suite under `test/V1.0/` with mock Provider, thin README indexes, and root `pnpm test:functional`.

**Architecture:** Independent Playwright project at repo root `test/V1.0` launches the real Electron main/preload against a Vite renderer (same pattern as `apps/desktop/e2e`), isolates each run with `JARVIS_DATA_DIR` + unique daemon port, and drives model-dependent paths through a local OpenAI-compatible mock HTTP server. Existing `apps/desktop/e2e` stays untouched.

**Tech Stack:** Playwright (`@playwright/test` from `apps/desktop`), Electron, Node `http` mock, TypeScript ESM, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-06-functional-test-V1.0-design.md`

## Global Constraints

- Version folder is `test/V1.0/` — uppercase `V`; never `v1.0`.
- Approach B: runnable specs + thin README; no lengthy case-table docs.
- Depth: Electron + IPC; model paths MUST use mock Provider; no real API keys in repo/fixtures/env defaults.
- Do NOT delete, move, or break `apps/desktop/e2e`.
- Prefer `data-testid` selectors; never `expect(true)` placeholders; P2 uses `test.skip` with reason.
- Destructive wipe/backup only against temp `JARVIS_DATA_DIR`.
- Renderer Vite host stays `127.0.0.1` (reuse `apps/desktop/vite.e2e.config.ts`).
- **Commits:** User rule for this session — do NOT `git commit` unless the user explicitly asks. Skip plan commit steps; leave a clean change set for a later requested commit.
- One task = independently runnable slice; verify with targeted Playwright before moving on.

## File structure

```
test/
  README.md
  V1.0/
    README.md
    playwright.config.ts
    global-setup.ts
    helpers/
      electron-app.ts
      mock-provider.ts
      fixtures.ts
    suites/
      01-shell-onboarding.spec.ts
      02-providers-models.spec.ts
      03-agents-templates.spec.ts
      04-chat-sessions.spec.ts
      05-task-board-approvals.spec.ts
      06-settings-mcp-skills.spec.ts
      07-coding-diff.spec.ts
      08-office-hub.spec.ts
      09-squad-workflow.spec.ts
      10-daemon-runtime.spec.ts
      11-data-safety-config.spec.ts
      12-shortcuts-usage-audit.spec.ts
package.json                          # add test:functional script
```

Reference implementations to copy patterns from (do not import spec files):
- `apps/desktop/e2e/helpers/electron-app.ts`
- `apps/desktop/e2e/global-setup.ts`
- `apps/desktop/e2e/electron-smoke.spec.ts`
- `apps/desktop/playwright.config.ts`
- `apps/desktop/vite.e2e.config.ts`

---

### Task 1: Scaffold `test/V1.0` + root script + Playwright config

**Files:**
- Create: `test/README.md`
- Create: `test/V1.0/README.md`
- Create: `test/V1.0/playwright.config.ts`
- Create: `test/V1.0/global-setup.ts`
- Modify: `package.json` (root) — add `"test:functional"` script
- Create: `test/V1.0/suites/.gitkeep` (placeholder until Task 3)

**Interfaces:**
- Consumes: none
- Produces:
  - Root script: `pnpm test:functional` → `pnpm --dir apps/desktop exec playwright test --config ../../test/V1.0/playwright.config.ts` (or equivalent cwd/`config` path that resolves `@playwright/test` from desktop)
  - Config: `testDir: './suites'`, `globalSetup: './global-setup.ts'`, timeout `120_000`, workers `1`, webServer pointing at desktop `vite.e2e.config.ts`

- [ ] **Step 1: Write root README and V1.0 README**

`test/README.md`:

```markdown
# JARVIS functional tests

Versioned Electron + IPC suites. Directory names use uppercase `V` (e.g. `V1.0`, `V1.1`).

## Run current release suite

```bash
pnpm test:functional
```

## Add a new version

Copy `V1.0/` to `V1.1/`, update coverage matrix, point `test:functional` (or add `test:functional:V1.1`) at the new config.
```

`test/V1.0/README.md` — coverage matrix table listing all 12 suite files with columns: Suite | Domains | Tiers (P0/P1/P2). Mark suites not yet implemented as “pending” until later tasks land.

- [ ] **Step 2: Write `global-setup.ts`**

Mirror `apps/desktop/e2e/global-setup.ts`: if `apps/desktop/out/main/index.js` missing or `CI` set, run `pnpm exec electron-vite build` in `apps/desktop`; always `pnpm exec electron-rebuild -f -w better-sqlite3` in `apps/desktop`. Resolve paths with `fileURLToPath` relative to `test/V1.0` → `../../apps/desktop`.

- [ ] **Step 3: Write `playwright.config.ts`**

```typescript
import { defineConfig } from '@playwright/test';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(ROOT, '../../apps/desktop');

export default defineConfig({
  testDir: './suites',
  timeout: 120_000,
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  projects: [
    {
      name: 'electron-functional',
      use: { headless: true },
      webServer: {
        command: 'pnpm exec vite --config vite.e2e.config.ts',
        cwd: DESKTOP,
        url: 'http://127.0.0.1:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
    },
  ],
});
```

- [ ] **Step 4: Add root script**

In root `package.json` scripts:

```json
"test:functional": "pnpm --dir apps/desktop exec playwright test --config ../../test/V1.0/playwright.config.ts"
```

Verify the relative `--config` path resolves when cwd is `apps/desktop` (Playwright resolves config path relative to cwd). If broken, use absolute path via `node -e` wrapper or `playwright test -c` from a small `test/V1.0/run.mjs` that `chdir`s correctly — pick the first approach that works.

- [ ] **Step 5: Sanity check config loads**

Run: `pnpm test:functional --list` (or `playwright test --list` with same config)  
Expected: exits 0; lists 0 tests if only `.gitkeep`, or reports empty suite without config errors.

- [ ] **Step 6: Commit** — SKIP unless user asked (session rule).

---

### Task 2: Helpers — electron launch, mock provider, fixtures

**Files:**
- Create: `test/V1.0/helpers/electron-app.ts`
- Create: `test/V1.0/helpers/mock-provider.ts`
- Create: `test/V1.0/helpers/fixtures.ts`
- Create: `test/V1.0/suites/00-helpers-smoke.spec.ts` (minimal: launch app, assert bridge, start/stop mock)

**Interfaces:**
- Consumes: Electron entry `apps/desktop/out/main/index.js`; env `JARVIS_E2E`, `JARVIS_DATA_DIR`, `JARVIS_DAEMON_PORT`, `ELECTRON_RENDERER_URL`
- Produces:

```typescript
// electron-app.ts
export function createIsolatedDataDir(): string;
export function removeDataDir(dir: string): void;
export interface LaunchedJarvis {
  app: ElectronApplication;
  window: Page;
  dataDir: string;
}
export async function launchJarvisElectron(dataDir?: string): Promise<LaunchedJarvis>;
export async function completeOnboarding(window: Page): Promise<void>;

// mock-provider.ts
export interface MockProviderHandle {
  baseUrl: string; // e.g. http://127.0.0.1:PORT/v1
  port: number;
  close(): Promise<void>;
}
export async function startMockOpenAIProvider(opts?: {
  replyText?: string;
}): Promise<MockProviderHandle>;
// Implements POST /v1/chat/completions — JSON and stream=true SSE with one assistant delta + done

// fixtures.ts
export function makeTempWorkspace(files?: Record<string, string>): string;
export function removeTempWorkspace(dir: string): void;
```

- [ ] **Step 1: Implement `electron-app.ts`**

Copy structure from `apps/desktop/e2e/helpers/electron-app.ts`. Set `DESKTOP_ROOT` to `join(helpersDir, '../../../apps/desktop')`, `MAIN_ENTRY` to `out/main/index.js`, `RENDERER_URL` default `http://127.0.0.1:5173`, incrementing daemon ports from `17900`.

`completeOnboarding`: goto `/onboarding`, click `onboarding-next` ×2, `onboarding-finish`, wait for `chat-page`.

- [ ] **Step 2: Implement `mock-provider.ts`**

Use Node `http.createServer`. Listen on `127.0.0.1:0`. Handle:
- `POST /v1/chat/completions` (also accept `/chat/completions`)
- If `body.stream`: write SSE chunks `data: {"choices":[{"delta":{"content":"..."}}]}\n\n` then `data: [DONE]\n\n`
- Else: JSON `{ id, choices: [{ message: { role: 'assistant', content: replyText } }] }`
- `GET /health` → `ok`

- [ ] **Step 3: Implement `fixtures.ts`**

`makeTempWorkspace` → `mkdtemp` + write relative files with `mkdirSync({ recursive: true })`.

- [ ] **Step 4: Write `00-helpers-smoke.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';
import {
  launchJarvisElectron, completeOnboarding, removeDataDir, createIsolatedDataDir,
} from '../helpers/electron-app';
import { startMockOpenAIProvider } from '../helpers/mock-provider';

test('helpers: launch + bridge + mock health', async () => {
  const mock = await startMockOpenAIProvider({ replyText: 'pong' });
  const dataDir = createIsolatedDataDir();
  const { app, window } = await launchJarvisElectron(dataDir);
  try {
    const hasBridge = await window.evaluate(() => typeof window.jarvis?.invoke === 'function');
    expect(hasBridge).toBe(true);
    const res = await fetch(`${mock.baseUrl.replace(/\/v1$/, '')}/health`);
    expect(res.ok).toBe(true);
    await completeOnboarding(window);
    await expect(window.getByTestId('chat-page')).toBeVisible();
  } finally {
    await app.close();
    removeDataDir(dataDir);
    await mock.close();
  }
});
```

- [ ] **Step 5: Run helper smoke**

Run: `pnpm test:functional --grep "helpers:"`  
Expected: PASS (may take >1 min first time due to build/rebuild).

- [ ] **Step 6: Commit** — SKIP unless user asked.

---

### Task 3: Suites 01–03 — shell/onboarding, providers/models, agents/templates

**Files:**
- Create: `test/V1.0/suites/01-shell-onboarding.spec.ts`
- Create: `test/V1.0/suites/02-providers-models.spec.ts`
- Create: `test/V1.0/suites/03-agents-templates.spec.ts`
- Modify: `test/V1.0/README.md` — mark 01–03 implemented
- Delete: `test/V1.0/suites/.gitkeep` if present

**Interfaces:**
- Consumes: `launchJarvisElectron`, `completeOnboarding`, `startMockOpenAIProvider`, `IpcChannel` from `@jarvis/protocol` (resolve via desktop’s workspace dependency — if import fails from test tree, use string channel names matching `packages/protocol`)

- [ ] **Step 1: `01-shell-onboarding.spec.ts` (P0)**

Tests:
1. Onboarding completes → `chat-page` visible; sidebar `nav-chat` / `nav-settings` visible.
2. Relaunch same `dataDir` → no `onboarding` testid; lands on chat.
3. Language switcher on providers settings: select `en`, assert English title on `provider-settings` (same as desktop smoke).

- [ ] **Step 2: `02-providers-models.spec.ts` (P0)**

After onboarding + mock server:
1. Via UI or IPC: create provider `{ name, type: 'openai', baseUrl: mock.baseUrl, apiKey: 'sk-test' }` using channels `provider.create` / form testids `provider-add-open`, `provider-name`, `provider-type`, `provider-baseurl`, `provider-apikey`, `provider-save`.
2. Add model via `provider-model-id` / `provider-model-name` / `provider-model-add` or IPC `provider.addModel`.
3. Assert provider appears in list (`provider-models-{id}` or list IPC).
4. Delete provider; list empty or without that id.

Inspect actual `ProviderInput` / form fields in `apps/desktop/src/renderer` before asserting exact option values for `provider-type`.

- [ ] **Step 3: `03-agents-templates.spec.ts` (P0)**

1. IPC or UI `agent.create` → appear in `/agents` and `agent-switcher`.
2. Open `/agents/templates`, click a template `create-{id}` (use first available card), assert new agent in list.
3. If templates empty in fresh DB, seed via IPC `agent-templates.list` — if list empty, skip template create with reason, still pass agent CRUD.

- [ ] **Step 4: Run**

`pnpm test:functional --grep "01-|02-|03-|shell|providers|agents"`  
Expected: P0 tests PASS.

- [ ] **Step 5: Commit** — SKIP unless user asked.

---

### Task 4: Suites 04–05 — chat sessions + task board / approvals

**Files:**
- Create: `test/V1.0/suites/04-chat-sessions.spec.ts`
- Create: `test/V1.0/suites/05-task-board-approvals.spec.ts`

**Interfaces:**
- Consumes: mock provider + provider/model/agent seeded in `beforeAll`/`beforeEach` helper pattern (inline setup function `seedChatStack(window, mock)` that creates provider, model, agent bound to model)

- [ ] **Step 1: `04-chat-sessions.spec.ts`**

P0: `chat-new` → session count ≥ 1 via IPC `chat.listSessions`.  
P1: type into `chat-input`, click `chat-send`, wait for assistant `message-assistant` or `streaming-text` containing mock `replyText`. If send requires agent selection, select via `agent-switcher` first. If P1 blocked by missing wiring, fail loudly only after checking testids — do not fake pass.

- [ ] **Step 2: `05-task-board-approvals.spec.ts`**

P0: goto `/board`, assert `task-board` and columns `col-queued` … `col-cancelled` exist.  
P0/P1: create task via IPC `task.create` with seeded agent + prompt; assert card appears in a column OR task control bar `task-control` shows status.  
P1 approval: if `approval-modal` appears for dangerous tool, click `approval-deny` or `approval-approve`. If no approval in mock path, `test.skip` with reason “no approval:request under mock reply”.  
P2 Multica: `test.skip(true, 'Multica harness not in V1.0 suite')`.

- [ ] **Step 3: Run**

`pnpm test:functional suites/04-chat-sessions.spec.ts suites/05-task-board-approvals.spec.ts`  
Expected: P0 pass; P1 pass or explicit skip with reason.

- [ ] **Step 4: Commit** — SKIP unless user asked.

---

### Task 5: Suites 06–07 — settings MCP/skills/env/permissions + coding

**Files:**
- Create: `test/V1.0/suites/06-settings-mcp-skills.spec.ts`
- Create: `test/V1.0/suites/07-coding-diff.spec.ts`

- [ ] **Step 1: `06-settings-mcp-skills.spec.ts` (P0)**

For each route, after onboarding:
- `/settings/mcp` → `mcp-settings` visible; fill name/command, `mcp-add`, assert row (use `echo`/`true` as harmless command — do not require live MCP handshake for P0; P1 `mcp-test-*` may skip if process fails).
- `/settings/skills` → `skills-settings` visible.
- `/settings/permissions` → select agent, set level, save; re-read via settings IPC or reload.
- `/settings/env` → set env text, save.
- `/settings/concurrency` → set values, save (restart may occur — wait for UI stable).

- [ ] **Step 2: `07-coding-diff.spec.ts`**

P0: `makeTempWorkspace({ 'src/a.ts': ' const x = 1\n' })`, bind agent workspace via IPC/`dialog` bypass if available (`workspace.bind` or agent update with path). Open `/coding`, assert `coding-panel` + `file-tree`.  
P1: if diff UI needs engine-produced patch, drive mock to emit a tool/diff or seed diff via IPC `diff.read` if supported; accept hunk if `hunk-0-accept` exists. Else skip P1 with reason documenting missing seed path.

- [ ] **Step 3: Run targeted specs — expect P0 PASS.

- [ ] **Step 4: Commit** — SKIP unless user asked.

---

### Task 6: Suites 08–09 — office hub + squad/workflow

**Files:**
- Create: `test/V1.0/suites/08-office-hub.spec.ts`
- Create: `test/V1.0/suites/09-squad-workflow.spec.ts`

- [ ] **Step 1: `08-office-hub.spec.ts`**

P0: `/office` → `office-page`, click each `office-tab-*` that exists (writing, pdf, composer, templates, search, web, video, image, globalsearch), assert panel testid for writing at minimum (`writing-view`).  
P1: with mock provider configured, use writing polish/summarize control if present; assert `writing-live` or result region updates. Skip individual tabs that need external binaries with reason.

- [ ] **Step 2: `09-squad-workflow.spec.ts`**

P0: `/squad` → `squad-view`; `/workflow` → `workflow-editor`.  
P0: open squad create form (`squad-new`), assert form fields.  
P1: create squad with leader/member if agents seeded; if engine cannot complete without more infra, assert create IPC/`squad-create-submit` does not crash and skip deep approve.  
P2: full S5 approve chain may `test.skip` if mock cannot drive multi-agent.

- [ ] **Step 3: Run targeted — P0 PASS.

- [ ] **Step 4: Commit** — SKIP unless user asked.

---

### Task 7: Suites 10–12 — daemon, data-safety/config, shortcuts/usage/audit

**Files:**
- Create: `test/V1.0/suites/10-daemon-runtime.spec.ts`
- Create: `test/V1.0/suites/11-data-safety-config.spec.ts`
- Create: `test/V1.0/suites/12-shortcuts-usage-audit.spec.ts`
- Modify: `test/V1.0/README.md` — full matrix current

- [ ] **Step 1: `10-daemon-runtime.spec.ts`**

P0: `/settings/daemon` → `daemon-management`, `daemon-running` visible (text non-empty). Optional restart click + wait.  
P2: injection approvals / Multica — skip without harness.

- [ ] **Step 2: `11-data-safety-config.spec.ts`**

P0: `/settings/data-safety` tabs backup/wipe visible.  
P0: `backup-now` against isolated dataDir → `backup-item` appears OR list IPC shows entry.  
P0: `/settings/config` → export JSON via UI/IPC; assert exported object has no plaintext `apiKey` field (only `apiKeyRef` or equivalent). Import with `merge` strategy smoke.  
Wipe: only if confirmations can be filled in UI (`wipe-phrase`); otherwise exercise via IPC in isolated dir and assert relaunch flag — do not wipe developer home `.jarvis`.

- [ ] **Step 3: `12-shortcuts-usage-audit.spec.ts`**

P0: `/settings/shortcuts` → `shortcuts-view`.  
P0: `/settings/usage` → `usage-dashboard` (loading then total or empty state).  
P0: `/settings/audit` → `audit-log`.  
Optional: seed audit row via performing a prior provider create in same dataDir.

- [ ] **Step 4: Run full suite**

`pnpm test:functional`  
Expected: all P0 green; P1 green or explicit skips; zero `expect(true)` placeholders.

- [ ] **Step 5: Update README matrix** to reflect final tiers per file.

- [ ] **Step 6: Commit** — SKIP unless user asked.

---

### Task 8: Final verification + README polish

**Files:**
- Modify: `test/README.md`, `test/V1.0/README.md` as needed
- Modify: any flaky helper timeouts discovered in Task 7

- [ ] **Step 1: Run full `pnpm test:functional` once more; capture pass/skip counts.

- [ ] **Step 2: Confirm acceptance criteria from spec**

1. Runs without real Provider key  
2. P0+P1 pass or skip with reasons  
3. README matrix complete  
4. Uppercase `V` documented  
5. No wipe outside temp dirs  
6. Config export has no plaintext keys  

- [ ] **Step 3: Self-review — grep `expect(true)` and `test.skip` under `test/V1.0`; remove fake passes.

- [ ] **Step 4: Commit** — SKIP unless user asked. Report summary to user with how to run and any intentional skips.

---

## Spec coverage checklist (plan self-review)

| Spec requirement | Task |
|------------------|------|
| `test/V1.0/` uppercase V | 1 |
| Thin README index + matrix | 1, 7, 8 |
| Playwright config + global setup | 1 |
| Helpers electron / mock / fixtures | 2 |
| Twelve suite files | 3–7 |
| Root `test:functional` | 1 |
| P0/P1/P2 + no fake passes | 3–8 |
| Keep `apps/desktop/e2e` | Global + no task touches it |
| Mock provider, no real keys | 2, 4, 6, 7 |
| Isolated data dirs / safe wipe | 2, 7 |

No TBD placeholders in tasks. Helper signatures consistent across tasks.
