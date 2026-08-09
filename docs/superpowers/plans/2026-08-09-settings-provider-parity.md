# Settings Provider-Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align all settings pages with Provider UX (layout, DataTable, Modal, EnableToggle, client+IPC validation) in nav-group batches.

**Architecture:** Extract shared `FieldInput` and validation helpers; add per-domain `*_FIELD_MAX` in protocol; migration v16 for `mcp_servers.enabled` / `skills.enabled`; each settings page consumes the same patterns as Provider.

**Tech Stack:** React 19 renderer, Electron IPC, better-sqlite3 migrations, `@jarvis/protocol`, `@jarvis/ui`, vitest, i18n zh-CN/en.

## Global Constraints

- Local-only; no telemetry. zh-CN + en symmetric (`pnpm i18n:check`).
- Renderer imports `@jarvis/core/renderer` only when needed; prefer `@jarvis/protocol` for shared validation.
- IPC returns `{ ok: true|false }` value shapes; never rely on unhandled rejection for UX.
- Append migrations only (latest was v15 → v16 for enable flags).
- No `window.confirm`; use `Modal` / `ModalMessage`.
- Commit convention: one commit per completed task, `feat:`/`fix:`/`test:` prefix.
- TDD: failing test → implement → green → commit.

---

## File map

| Area | Create / modify |
|------|-----------------|
| Shared FieldInput | `apps/desktop/src/renderer/src/components/settings/FieldInput.tsx` (+ spec); `ProviderForm.tsx` import it |
| Protocol max | `packages/protocol/src/index.ts` (+ `mcp-fields` / `settings-fields` as needed) |
| Migration v16 | `apps/desktop/src/main/db/migrations.ts` (+ spec) |
| MCP | `McpSettingsPage.tsx`, main mcp store/IPC, i18n |
| Skills | `SkillsSettingsPage.tsx`, skills IPC, i18n |
| Concurrency / shell | concurrency page; Daemon/Logs headers |
| Permissions / Env | those pages + agent update validation |
| Data / Config / Shortcuts | panes + Modal + validation |
| Usage / Audit | PageHeader / EmptyState only |

---

### Task 0.1: Extract FieldInput

**Files:**
- Create: `apps/desktop/src/renderer/src/components/settings/FieldInput.tsx`
- Create: `apps/desktop/src/renderer/src/components/settings/FieldInput.spec.tsx`
- Modify: `ProviderForm.tsx` (import shared)

- [ ] Write FieldInput spec (renders error, aria-invalid, clears via onChange parent)
- [ ] Implement FieldInput (move from ProviderForm)
- [ ] Update ProviderForm; run ProviderSettingsPage + FieldInput specs
- [ ] Commit: `refactor(settings): extract shared FieldInput`

### Task 0.2: Protocol FIELD_MAX stubs for MCP/Skills

**Files:**
- Modify: `packages/protocol/src/index.ts` (or new `settings-fields.ts` re-exported)
- Modify: `packages/protocol/src/index.spec.ts`

- [ ] Add `MCP_FIELD_MAX`, `SKILL_FIELD_MAX` (name/command/args/url lengths — mirror provider style)
- [ ] Tests for constants
- [ ] Commit: `feat(protocol): add MCP and Skills field max constants`

### Task 1.1: Migration v16 enabled columns

**Files:**
- Modify: `apps/desktop/src/main/db/migrations.ts`
- Modify: `apps/desktop/src/main/db/migrations.spec.ts`

- [ ] Failing test expecting latestVersion 16 and columns present
- [ ] Add v16 migration
- [ ] Green + commit: `feat(db): v16 mcp_servers and skills enabled flags`

### Task 1.2: MCP IPC enable + validation lengths

**Files:**
- MCP main store/IPC (find under `apps/desktop/src/main/ipc/`)
- `packages/protocol` channels/allowlist if needed
- specs

- [ ] Tests: create rejects empty name/command / overlong; setEnabled; list runtime filters
- [ ] Implement + commit: `feat(mcp): enable flag and field length validation`

### Task 1.3: MCP settings UI Provider-parity

**Files:**
- `McpSettingsPage.tsx` + spec
- i18n both locales

- [ ] Specs: PageHeader, DataTable, FieldInput errors, Modal delete, EnableToggle
- [ ] Implement UI
- [ ] `pnpm i18n:check` + commit: `feat(mcp): align settings UI with Provider patterns`

### Task 1.4: Skills IPC enable + URL validation

- [ ] Tests + implement setEnabled, URL length/protocol on import
- [ ] Commit: `feat(skills): enable flag and import validation`

### Task 1.5: Skills settings UI Provider-parity

- [ ] Specs + DataTable + enable + delete Modal + URL FieldInput
- [ ] i18n + commit: `feat(skills): align settings UI with Provider patterns`

### Task 2.1: Concurrency validation + chrome

- [ ] Specs for bounds / required / feedback
- [ ] Implement + commit: `feat(settings): harden concurrency form validation`

### Task 2.2: Daemon + Logs shell alignment

- [ ] PageHeader/subtitle/EmptyState consistency
- [ ] Commit: `refactor(settings): align daemon and logs page chrome`

### Task 3.1: Permissions page parity

- [ ] Agent-required, save feedback, PageHeader
- [ ] Commit: `feat(settings): align permissions page with Provider patterns`

### Task 3.2: Env page validation

- [ ] KEY=value line validation + lengths + feedback
- [ ] Commit: `feat(settings): validate agent env and cli args forms`

### Task 4.1: Data safety Modals + structured results

- [ ] Replace confirm; wipe phrase FieldInput; commit

### Task 4.2: Config import/export UX

- [ ] Modal overwrite; mapped errors; summary; commit

### Task 4.3: Shortcuts conflict + chrome

- [ ] Conflict detection; PageHeader/table; commit

### Task 5: Usage + Audit shell

- [ ] PageHeader/EmptyState; commit: `refactor(settings): align usage and audit chrome`

### Task final: Verification

- [ ] Run targeted vitest for touched packages + `pnpm i18n:check`
- [ ] Fix regressions; no drive-by refactors

---

## Execution notes

- Prefer `subagent-driven-development` with independent tasks in parallel when safe (e.g. Skills UI after MCP IPC lands separately).
- After each batch, keep `master` (or feature branch if created) buildable.
- User authorized autonomous execution through morning of 2026-08-09 08:00 Asia/Shanghai.
