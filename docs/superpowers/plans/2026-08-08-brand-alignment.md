# Brand Alignment Implementation Plan

> **For agentic workers:** Implement task-by-task with TDD. Do **not** git-commit unless the user asks.

**Goal:** Align all desktop UI modules to the I2 lattice brand via tokens + shared mark + key empty/welcome surfaces.

**Architecture:** Change `packages/ui` accent tokens so CTAs/nav/bubbles cascade; add `JarvisMark` in the renderer; wire sidebar, onboarding, chat empty; optional EmptyState icon; favicon. No business-flow redesign.

**Tech Stack:** React 19, CSS variables in `@jarvis/ui`, vitest, existing i18n keys.

## Global Constraints

- No purple brand accents (`tokens.spec.ts`).
- Renderer brand SVG stays in desktop app (not `@jarvis/core`).
- Prefer existing i18n keys (`chat.welcome*`); `pnpm i18n:check` if keys added.
- Do not commit per user request.

---

### Task 1: Tokens

**Files:** `packages/ui/src/styles/tokens.css`, `tokens.spec.ts`

- [x] Update light/dark `--accent`, `--info`, `--bubble-user`, muted/subtle
- [x] Spec expects `#2563eb` (not `#007aff`)

### Task 2: JarvisMark

**Files:** Create `apps/desktop/src/renderer/src/components/brand/JarvisMark.tsx` (+ css, spec)

- [x] `size`: sm|md|lg; `variant`: mark|app
- [x] Geometry from `resources/icon.svg` lattice

### Task 3: Sidebar brand

**Files:** `AppLayout.tsx`, `AppLayout.spec.tsx`, `desktop.css`

- [x] Pass `brand` to Sidebar with mark + title
- [x] Update tests that currently expect no brand title

### Task 4: Onboarding + Chat empty

**Files:** `OnboardingPage.tsx`, `ChatPage.tsx`, CSS as needed

- [x] Hero mark on onboarding
- [x] Chat empty: mark + `chat.welcome` / `welcomeHint`

### Task 5: EmptyState icon + module empties

**Files:** `packages/ui/.../EmptyState.tsx` (+ css, spec if any), call sites as needed

- [x] Optional `icon?: ReactNode`
- [x] Use small mark on canvas/workflow/logs empty where natural

### Task 6: Favicon + accent hex sweep

**Files:** `index.html`; grep `#007aff`/`#0a84ff` in ui/desktop

- [x] Link favicon to icon asset
- [x] Replace leftover accent hardcodes

### Task 7: Verify

- [x] `pnpm vitest` on touched packages; `pnpm i18n:check` if needed
