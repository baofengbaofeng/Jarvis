# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

JARVIS is a local-first (纯本地, no telemetry/cloud) AI assistant desktop app, built zh-CN-first with full en support. It is developed milestone-by-milestone (M0–M8, now at 1.0.0-Preview freeze level). Product/requirements/tutorial docs live under `wiki/` (HTML); `docs/provider-guide.md` documents third-party provider onboarding. Implementation plans and design specs directories under `docs/superpowers/plans/` and `docs/superpowers/specs/` are reserved placeholders.

## Commands

Run everything from the repo root via pnpm + Turbo (node ≥ 20.11, pnpm 9.12):

- `pnpm build` / `pnpm dev` / `pnpm test` / `pnpm typecheck` — turbo run across all workspaces
- `pnpm i18n:check` — must pass before committing UI work: verifies zh-CN/en keys are symmetric (`node scripts/i18n-check.mjs`, fails on mismatch)
- Single test file: `cd packages/core && pnpm vitest run src/model/usage.spec.ts` (same pattern in any workspace)
- Desktop app: `cd apps/desktop && pnpm dev` (electron-vite dev), `pnpm e2e` (Playwright, `e2e/*.spec.ts` — excluded from vitest), `pnpm build:daemon` (compiles the Go daemon binary into `resources/daemon/`)
- Native module: after a Node/Electron version change, `cd apps/desktop && pnpm rebuild:electron` to rebuild `better-sqlite3`
- Go daemon: `cd daemon && go build ./... && go test ./...`

Tests are colocated as `*.spec.ts`/`*.spec.tsx` next to source (vitest + jsdom for desktop; `apps/desktop/vitest.setup.ts` installs a ResizeObserver no-op for react-flow specs). E2E specs live in `apps/desktop/e2e/`.

## Architecture

Five layers, bottom to top:

1. **SQLite** (WAL mode) — `~/.jarvis/jarvis.db`; backups `~/.jarvis/backups/`, logs `~/.jarvis/logs/`, per-task workspaces `~/.jarvis/workspaces/{id}/`.
2. **Go daemon** (`daemon/`, module `github.com/baofengbaofeng/Jarvis/daemon`) — `cmd/jarvis-daemon` owns the runtime: concurrency queue (`internal/runtime`), HTTP on `127.0.0.1:17890` (`internal/httpapi`), and the Multica client (`internal/multica`) for registration/heartbeat/claim/execute. `cmd/jarvis-agent` is a thin cobra CLI that executes claimed tasks by running an embedded Node REACT-loop (see "Engine ownership").
3. **Electron main + IPC** (`apps/desktop/src/main`) — bootstrap in `src/main/index.ts`; the `IpcRouter` (`src/main/ipc/IpcRouter.ts`) registers every IPC channel; better-sqlite3 persistence for main-owned tables; `DaemonSupervisor` spawns/monitors the daemon; `SecureStorage` wraps Keychain (macOS) for API keys.
4. **`packages/core`** — the engine layer: `AgentEngine`, `ModelRouter` + `model/adapters` (openai/anthropic), `ToolRegistry`, `MCPClient`, task state machine/orchestrator, sandbox, squad, coding (index/LSP/diff), office, audit, config-transfer, shortcuts, canvas artifacts. **`packages/ui` and `packages/views` are scaffolding only** (version constants; pages/components live in the desktop renderer).
5. **Electron renderer** (`apps/desktop/src/renderer`) — React 19 + react-router-dom (BrowserRouter, route table in `App.tsx`), zustand stores (`src/renderer/src/stores/`), react-i18next.

`packages/protocol` defines IPC channel names (`IpcChannel`/`IpcEvent`) and shared data types; it must not depend on `@jarvis/core`.

### Engine ownership (decision A)

`AgentEngine`/REACT loop/`ModelRouter`/`MCPClient` are implemented **once, in TS in `packages/core`**. The Go `jarvis-agent` is a thin protocol shell only — for Multica-claimed tasks it runs an embedded Node process executing the same TS engine; Go never re-implements the engine. Local tasks run the TS engine inside the Electron main process; the daemon only schedules/queues.

### Two core entry points (critical)

- `@jarvis/core` — full barrel (`packages/core/src/index.ts`); includes Node-dependent modules (`node:*` imports) that cannot bundle for the browser.
- `@jarvis/core/renderer` — `packages/core/src/renderer.ts` re-exports only pure, dependency-free modules.

**Renderer code must import from `@jarvis/core/renderer`**, never the full barrel. `renderer.ts` has a comment block documenting which modules are safe; keep it in sync when adding modules.

### IPC pattern

Preload (`src/preload/index.ts`) exposes `window.jarvis.invoke(channel, ...args)` and `window.jarvis.onDidReceive(channel, cb)`. Renderer stores call these; main handlers live in `IpcRouter.registerAll`. Convention: handlers return `{ ok: true, ... }` / `{ ok: false, error }` value-shaped results rather than rejecting the ipcMain channel (so the renderer never sees an unhandled rejection). Several channels take a **single object payload** even when one arg would do — check the preload/`register` comment when a channel destructures `(args ?? {})`.

### SQLite schema & migrations

Migrations are an ordered array of `{ version, sql }` in `apps/desktop/src/main/db/migrations.ts`, applied via `schema_migrations` (current latest = v15). Comments in that file are important: several v1 tables had vestigial legacy shapes that later milestones had to `DROP`/`ALTER` in place (token_usage v10, audit_logs v11). When adding a table, **append a new migration** — never edit applied ones.

Writer ownership (§13.3): Electron main owns providers/models/agents/settings/chat/mcp_servers/skills/prompt_templates; the daemon owns tasks/squads/agent_messages/agent_call_edges/audit/token_usage/runtime_profiles. In practice today the main process writes most tables and the daemon writes its own (e.g. L36 multica task-id mapping).

### i18n

All UI must ship zh-CN **and** en symmetrically. Locales live in `packages/i18n/locales/{zh-CN,en}/common.json`; the root `pnpm i18n:check` gates on key symmetry. No hardcoded UI strings.

## Non-obvious constraints

- **No hardcoded model ids** (Q4): provider/model ids are user-defined, never baked into code, config, or seed data. Provider templates intentionally carry an empty model list.
- **API keys never land on disk in plaintext**: keychain via `SecureStorage`, config/export carries only `apiKeyRef`. Config export/import (C12) validates `schemaVersion` (`1.0.0-Preview`; legacy numeric ≤ 12 still accepted on import) and supports `skip | overwrite | merge` strategies.
- **Local-only**: no telemetry, no cloud sync. The `settings.data_policy.local_only` toggle is declarative only.
- **Pure logic goes in `packages/core`; main does wiring + persistence; renderer is views.** A new feature typically needs a core pure module + spec, a main IPC handler, a zustand store, a renderer component + spec, and i18n keys in both locales.
- **Every milestone's Global Constraints** apply to all work: performance targets (<3s cold start), path conventions, single-writer tables, and the 1.0.0-Preview exclusion list (no global shortcuts, auto-update, offline mode, local models, Monaco, etc.).
- **Commit convention**: one commit per completed task, `feat:`/`fix:`/`test:`/`refactor:` prefix. Planned work is executed task-by-task with TDD steps using the superpowers skills (`subagent-driven-development` / `executing-plans`).
