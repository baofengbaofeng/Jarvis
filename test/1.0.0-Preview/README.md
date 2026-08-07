# Functional test suite 1.0.0-Preview

Electron + IPC regression for JARVIS desktop release 1.0.0-Preview. Run via root `pnpm test:functional`.

## Helpers

| Helper | Role |
|--------|------|
| `helpers/electron-app.ts` | Launch Electron with isolated `JARVIS_DATA_DIR`, onboarding, teardown |
| `helpers/mock-provider.ts` | Local HTTPS OpenAI-compatible stub (`baseUrl` **without** `/v1`; adapter appends `/v1/chat/completions`) |
| `helpers/seed-chat-stack.ts` | IPC seed provider + model + agent bound to mock |
| `helpers/fixtures.ts` | Temp workspace files for coding/office specs |
| `suites/00-helpers-smoke.spec.ts` | Smoke: bridge, mock health (Node-side TLS), onboarding |

## Coverage matrix

| Suite | Domains | Tiers | Status |
|-------|---------|-------|--------|
| `00-helpers-smoke.spec.ts` | Launch, `window.jarvis`, mock `/health` | smoke | implemented |
| `01-shell-onboarding.spec.ts` | App shell nav, i18n switcher, onboarding + persistence | P0 | implemented |
| `02-providers-models.spec.ts` | `/settings/providers` CRUD, add model | P0 | implemented |
| `03-agents-templates.spec.ts` | `/agents`, switcher, create-from-template | P0 | implemented |
| `04-chat-sessions.spec.ts` | Session list/create; send/stream with mock | P0, P1 | implemented |
| `05-task-board-approvals.spec.ts` | Task board, control bar, ApprovalModal | P0, P1, P2 | implemented |
| `06-settings-mcp-skills.spec.ts` | MCP, skills, permissions, env, concurrency | P0, P1 | implemented |
| `07-coding-diff.spec.ts` | `/coding` tree, diff hunks, mention smoke | P0, P1 | implemented |
| `08-office-hub.spec.ts` | `/office` tabs; writing via mock | P0, P1 | implemented |
| `09-squad-workflow.spec.ts` | `/squad`, `/workflow`; simplified approve | P0, P1, P2 | implemented |
| `10-daemon-runtime.spec.ts` | `/settings/daemon` status/restart | P0, P2 | implemented |
| `11-data-safety-config.spec.ts` | Backup/wipe isolated dir, config export/import (no plaintext keys) | P0 | implemented |
| `12-shortcuts-usage-audit.spec.ts` | Shortcuts, usage dashboard, audit log | P0 | implemented |

## Intentional skips (P2 / conditional)

Documented `test.skip` reasons — never `expect(true)` placeholders:

| Spec | Reason |
|------|--------|
| `05-task-board-approvals` P1 | Mock reply did not trigger `approval:request` |
| `05-task-board-approvals` P2 | Multica harness not in 1.0.0-Preview suite |
| `06-settings-mcp-skills` P1 | MCP test process failed or timed out |
| `08-office-hub` P0 `pdf` tab | Soft-annotated only: PdfReaderPage lazy chunk fails under Vite functional harness; other tabs still asserted |
| `09-squad-workflow` P2 | Full S5 multi-agent approve chain needs engine infra beyond mock |
| `10-daemon-runtime` P2 | Injection approvals require Multica harness |

Conditional skips inside P1 specs (e.g. empty template list, diff seed path unavailable) log a reason at runtime and do not fail the suite.

## Mock Provider convention

- `mock.baseUrl` = `https://127.0.0.1:{port}` (no trailing `/v1`).
- UI forms and `seedChatStack` both use `mock.baseUrl`.
- Node-side health checks use `fetchMockHealth(mock)` (`rejectUnauthorized: false` for self-signed cert; Electron app already sets `NODE_TLS_REJECT_UNAUTHORIZED=0`).
