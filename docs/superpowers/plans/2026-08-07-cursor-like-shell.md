# Cursor-like Shell & Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the desktop shell and Chat page to a Cursor-like two-column layout with AGENTS/CHATS/MORE sidebar, gear settings, and a fixed GitHub footer link.

**Architecture:** Extend `@jarvis/ui` `AppShell` with an optional main footer; rebuild `AppLayout` sidebar IA; restyle `ChatPage`/`ChatInput` empty vs active states; move `LanguageSwitcher` into Settings preferences; open the repo URL via existing `setWindowOpenHandler` → `shell.openExternal` (https + `target="_blank"`).

**Tech Stack:** Electron renderer (React 19), zustand stores, `@jarvis/ui`, `@jarvis/protocol`, react-i18next, vitest + Testing Library.

## Global Constraints

- zh-CN and en i18n keys must stay symmetric (`pnpm i18n:check`).
- No new Workspace entity; Agent↔workspace binding unchanged.
- No hardcoded model ids; version from `APP_VERSION`.
- Repo URL constant: `https://github.com/baofengbaofeng/Jarvis`.
- Renderer imports Node-free modules only; `@jarvis/protocol` is OK.
- Prefer value-shaped IPC results; no new IPC required for GitHub open.
- One commit per completed task; TDD (failing test → implement → pass).

## File map

| File | Responsibility |
|------|----------------|
| `packages/protocol/src/version.ts` (or `repo.ts`) | `GITHUB_REPO_URL` constant + export |
| `packages/i18n/locales/{en,zh-CN}/common.json` | Shell/Chat/settings copy |
| `packages/ui/src/components/AppShell.tsx` + `.css` | `mainFooter` slot; column layout |
| `apps/desktop/.../layouts/AppLayout.tsx` | Sidebar IA, search, gear, chats |
| `apps/desktop/.../layouts/SettingsLayout.tsx` | Host `LanguageSwitcher` |
| `apps/desktop/.../pages/ChatPage.tsx` | Remove sessions aside; empty/active layout |
| `apps/desktop/.../styles/desktop.css` | Cursor-like shell/chat polish |
| Specs colocated `*.spec.tsx` | Behavior locks |

---

### Task 1: Protocol repo URL + i18n keys

**Files:**
- Modify: `packages/protocol/src/version.ts`
- Modify: `packages/protocol/src/index.ts` (re-export if needed)
- Modify: `packages/i18n/locales/en/common.json`
- Modify: `packages/i18n/locales/zh-CN/common.json`
- Test: `packages/protocol/src/index.spec.ts` (or version spec)

**Interfaces:**
- Produces: `export const GITHUB_REPO_URL = 'https://github.com/baofengbaofeng/Jarvis'`
- Produces i18n keys under `shell.*`: `newChat`, `search`, `searchPlaceholder`, `groupAgents`, `groupChats`, `groupMore`, `settingsAria`, `repoLink`, `repoLinkAria`

- [ ] **Step 1: Write failing test for constant**

```ts
import { GITHUB_REPO_URL } from './version';
it('exports GitHub repo URL', () => {
  expect(GITHUB_REPO_URL).toBe('https://github.com/baofengbaofeng/Jarvis');
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd packages/protocol && pnpm vitest run src/index.spec.ts` (or dedicated file)

- [ ] **Step 3: Add constant + i18n keys (en + zh-CN symmetric)**

- [ ] **Step 4: Run `pnpm i18n:check` and protocol tests — PASS**

- [ ] **Step 5: Commit** `feat: add GitHub repo URL and shell i18n keys`

---

### Task 2: AppShell mainFooter slot

**Files:**
- Modify: `packages/ui/src/components/AppShell.tsx`
- Modify: `packages/ui/src/components/AppShell.css`
- Test: `packages/ui/src/components/AppShell.spec.tsx` (create if missing)

**Interfaces:**
- Produces: `AppShellProps.mainFooter?: ReactNode`
- Layout: main column is flex column; `children` scroll; footer sticky at bottom of main column

- [ ] **Step 1: Failing test** — renders `data-testid="jui-appshell-footer"` when `mainFooter` provided

- [ ] **Step 2: Implement minimal slot + CSS**

- [ ] **Step 3: Tests PASS; commit** `feat(ui): add AppShell mainFooter slot`

---

### Task 3: Settings hosts LanguageSwitcher

**Files:**
- Modify: `apps/desktop/src/renderer/src/layouts/SettingsLayout.tsx`
- Test: `apps/desktop/src/renderer/src/layouts/SettingsLayout.spec.tsx` (create/extend)

- [ ] **Step 1: Failing test** — preferences group contains `language-switcher`

- [ ] **Step 2: Render `<LanguageSwitcher />` beside `ThemeSwitcher`**

- [ ] **Step 3: PASS; commit** `feat(desktop): move language switcher into settings`

---

### Task 4: Rebuild AppLayout sidebar + GitHub footer

**Files:**
- Modify: `apps/desktop/src/renderer/src/layouts/AppLayout.tsx`
- Modify: `apps/desktop/src/renderer/src/layouts/AppLayout.spec.tsx`
- Modify: `apps/desktop/src/renderer/src/styles/desktop.css`

**Interfaces:**
- Consumes: `APP_VERSION`, `GITHUB_REPO_URL`, chat-store `sessions`/`newSession`/`loadSession`/`init`, agent-store
- Produces: testids `sidebar-new-chat`, `sidebar-search-toggle`, `sidebar-search-input`, `sidebar-settings-gear`, `shell-repo-link`, `sidebar-chat-{id}`

Behavior:
- New Chat → `newSession` + `navigate('/')`
- Search toggle → input; filter agents by name/slug/id and sessions by title/id (case-insensitive includes)
- Gear → `/settings/providers`
- No `LanguageSwitcher` in sidebar footer; no text Settings nav
- Footer link: `<a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">` display host+path

- [ ] **Step 1: Extend AppLayout.spec** for gear, repo link, no language-switcher in shell, brand version (already present)

- [ ] **Step 2: Implement sidebar IA + styles**

- [ ] **Step 3: PASS; commit** `feat(desktop): Cursor-like AppLayout sidebar and repo footer`

---

### Task 5: ChatPage Cursor layout

**Files:**
- Modify: `apps/desktop/src/renderer/src/pages/ChatPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/ChatPage.spec.tsx`
- Modify: `apps/desktop/src/renderer/src/styles/desktop.css`
- Optionally restyle Composer via desktop.css wrappers around existing `ChatInput`

- [ ] **Step 1: Failing tests** — no `chat-sessions` aside; empty state has `chat-empty-composer`; with messages still shows stream

- [ ] **Step 2: Remove aside; empty centered composer; active narrow column + bottom composer**

- [ ] **Step 3: PASS; commit** `feat(desktop): Cursor-like Chat page layout`

---

### Task 6: Visual polish + verification

**Files:**
- Modify: `packages/ui/src/styles/tokens.css` (sidebar/main bg if needed)
- Modify: `desktop.css` nav active rounded states

- [ ] **Step 1: Align `--sidebar-bg` / `--bg` with mock (`#f0f0f0` / `#fafafa` light)**

- [ ] **Step 2: Run** `cd apps/desktop && pnpm vitest run src/renderer/src/layouts/AppLayout.spec.tsx src/renderer/src/pages/ChatPage.spec.tsx` and `pnpm i18n:check`

- [ ] **Step 3: Commit** `style(desktop): polish Cursor-like shell tokens`

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| New Chat / Search / AGENTS / CHATS / MORE | 4 |
| Footer brand + gear | 4 |
| Language in Settings | 3 |
| GitHub footer open external | 1 + 4 |
| Chat empty/active, no inner sessions | 5 |
| Visual tokens | 6 |
| i18n symmetry | 1 |
| APP_VERSION brand | already done; kept in 4 |
