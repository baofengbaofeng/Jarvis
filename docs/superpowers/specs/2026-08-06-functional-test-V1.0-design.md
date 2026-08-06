# Functional Test Suite V1.0 — Design

**Date:** 2026-08-06  
**Status:** Approved  
**Scope:** Root `test/V1.0` Electron + IPC functional regression for JARVIS desktop  
**Out of scope:** Migrating or deleting `apps/desktop/e2e`; true Multica S6 without external harness; tray / window-snap automation; global hotkeys (product V2 exclusion)

## Goal

Provide a **runnable** functional test suite under the project root `test/` directory, versioned by product release (`V1.0`, uppercase `V`). Primary deliverable is Playwright scripts; documentation is limited to a short index and coverage matrix (approach B). Depth is **Electron + IPC** with a **local mock OpenAI-compatible Provider** — no hard-coded real API keys or external model calls in CI/local default runs.

## Decisions (locked)

| Decision | Choice |
|----------|--------|
| Deliverable shape | Runnable Playwright specs + thin README index (not lengthy case tables) |
| Version directory | `test/V1.0/` — uppercase `V`; new releases get new sibling dirs (e.g. `V1.1`); do not rewrite history |
| Automation depth | Electron + IPC; model-dependent paths use mock Provider |
| Layout vs existing e2e | Independent Playwright project under `test/V1.0`; keep `apps/desktop/e2e` as smoke / CI lightweight suite |
| Package entry | Root `pnpm test:functional` → runs `test/V1.0` |

## Directory layout

```
test/
  README.md                      # How to pick version / run suite
  V1.0/
    README.md                    # Coverage matrix: domain → spec → P0/P1/P2
    playwright.config.ts
    helpers/
      electron-app.ts            # Launch Electron; isolated JARVIS_DATA_DIR
      mock-provider.ts           # Local OpenAI-compatible HTTP + stream stub
      fixtures.ts                # Temp workspace, sample files
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
```

Optional: `test/V1.0/package.json` only if needed for local deps; prefer root/`apps/desktop` Playwright dependency and a root script that sets `cwd` to `test/V1.0`.

## Coverage tiers

### P0 — always run (UI reachability + CRUD / persistence)

Navigation/shell, onboarding persistence, Provider/Model CRUD (+ Keychain path for keys), Agent CRUD + switcher, chat session create/list, settings pages read/write (permissions, env, concurrency, MCP list scaffolding, skills list, data-safety panes visible), task board columns with seeded rows, daemon status page, config transfer UI present, shortcuts/usage/audit pages load, office tab smoke, coding panel + file tree against temp workspace, squad create form / workflow editor smoke.

### P1 — mock Provider required

Chat send → streaming reply appears; coding diff accept/reject against fixture workspace; office writing/summarize happy path via mock; approval modal approve/deny; simplified squad create → approve path when mock can drive engine.

### P2 — conditional skip

Multica claim/execute (S6) without external server harness; flows that require native file dialogs when not injectable via IPC — use IPC seeding where possible, else `test.skip` with comment. Never use `expect(true)` placeholders.

### Explicit exclusions

- Global shortcuts / system overlay (product excluded from V1.0)
- `VersionHistoryPage` (not mounted on any route)
- Deep Logs panel behavior while still a stub (page smoke only)
- Tray and window snap (manual checklist only; do not fail CI)

## Mock Provider strategy

1. Helper starts a local HTTP server implementing enough of OpenAI Chat Completions (non-stream + SSE stream) to drive `AgentEngine` / chat UI.
2. Specs create a Provider with `baseUrl` pointing at that server and a placeholder API key stored via SecureStorage / IPC (same path as production).
3. No real keys in repo, env defaults, or fixtures.
4. Tear down mock server after suite/file as appropriate.

## Runtime conventions

### Prerequisites

- Build Electron main/preload (`electron-vite build`) when `out/main` missing or in CI
- Rebuild `better-sqlite3` for Electron (`electron-rebuild`)
- Vite renderer on `http://127.0.0.1:5173` (reuse existing server when not CI)

### Isolation

- Each test (or describe block) uses a fresh `JARVIS_DATA_DIR` under OS temp
- Unique daemon port per launch to avoid collisions
- Wipe/restore/backup only against isolated dirs
- Clean up data dirs in `afterEach` / `afterAll`

### Authoring rules

- Prefer `data-testid` selectors
- Assert IPC value-shaped results (`{ ok: true|false, ... }`) where handlers use that convention
- P2 skips must document the missing condition in the skip reason

## Relationship to `apps/desktop/e2e`

| Suite | Role |
|-------|------|
| `apps/desktop/e2e` | Smoke, IPC allowlist, fast CI signal |
| `test/V1.0` | Full functional regression for release V1.0 |

Share patterns/helpers by copying or extracting shared helper modules later if duplication hurts; **do not** require `test/V1.0` specs to import from `apps/desktop/e2e/*.spec.ts`. Existing smoke specs are not deleted or moved in this work.

## Acceptance criteria

1. `pnpm test:functional` runs the V1.0 suite without a real Provider API key.
2. P0 + P1 pass on a clean machine after build/rebuild prerequisites.
3. `test/V1.0/README.md` lists every suite file with tier (P0/P1/P2).
4. `test/README.md` documents uppercase `V` version folder convention.
5. Destructive data-safety paths only touch temporary data dirs.
6. No plaintext API keys in exports exercised by config-transfer tests.

## Feature → suite mapping (inventory)

Aligned with desktop routes / settings; one suite file may cover multiple IPC channel groups.

| Suite file | Feature areas |
|------------|---------------|
| `01-shell-onboarding` | App shell nav, i18n switcher smoke, onboarding wizard + persistence |
| `02-providers-models` | `/settings/providers` CRUD, add model, mock baseUrl |
| `03-agents-templates` | `/agents`, switcher, `/agents/templates` create-from-template |
| `04-chat-sessions` | Session list/create; P1 send/stream with mock |
| `05-task-board-approvals` | Task control bar hooks, `/board`, ApprovalModal |
| `06-settings-mcp-skills` | MCP, skills, permissions, env, concurrency |
| `07-coding-diff` | `/coding` tree, diff hunks, mention smoke |
| `08-office-hub` | `/office` tabs; P1 writing via mock |
| `09-squad-workflow` | `/squad`, `/workflow`; P1 simplified approve |
| `10-daemon-runtime` | `/settings/daemon` status/restart; runtime UI smoke |
| `11-data-safety-config` | Backup/wipe isolated, config export/import |
| `12-shortcuts-usage-audit` | Shortcuts, usage dashboard, audit log |

## Delivery checklist

- [ ] `test/README.md` + `test/V1.0/README.md`
- [ ] Playwright config + helpers (electron, mock provider, fixtures)
- [ ] Twelve suite files with P0 coverage; P1 paths for chat/coding/office/approvals/squad where feasible
- [ ] Root `package.json` script `test:functional`
- [ ] P2 cases use explicit `test.skip`, not fake passes

## Non-goals for this design’s first implementation plan

- Wiring Multica end-to-end in CI
- Replacing vitest unit/component specs
- Changing product UI solely for testability beyond adding missing `data-testid`s when blockers appear
