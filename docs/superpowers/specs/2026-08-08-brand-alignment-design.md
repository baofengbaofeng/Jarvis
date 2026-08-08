# JARVIS Brand Alignment Design (全模块)

**Date:** 2026-08-08  
**Status:** Draft for review  
**Approach:** C — Token cascade + shared brand patterns (approved)

## 1. Context

Logo work settled on the **I2 Lattice Engine** mark: blue→teal gradient (`#2563eb → #0ea5e9 → #14b8a6`), complex centered structure, Codex/Apple craft (single bold symbol, no busy UI collage). Assets live under `apps/desktop/resources/` and are wired for window/tray/packaging.

In-app UI still uses Apple system blue (`#007aff` / `#0a84ff`) and rarely surfaces the product mark. This spec aligns **all feature modules** to the logo brand without redesigning business flows.

## 2. Goals

1. One accent system matching the logo / wiki palette across light and dark themes.
2. Shared `JarvisMark` (+ optional wordmark) on high-visibility chrome and empty/welcome surfaces.
3. Every major module inherits brand via tokens + a short empty-state / header pattern — no per-page one-off palettes.
4. Preserve existing IA, interactions, i18n symmetry, and the no-purple constraint.

## 3. Non-goals

- Redesigning layouts, workflows, or Multica/daemon protocols.
- Illustration walls, animated heroes, or marketing landing pages inside the app.
- Changing provider/model ids, copy tone beyond wiring existing unused welcome keys.
- Replacing nav stroke icons with the lattice mark (nav stays functional glyphs).

## 4. Visual principles (from logo dialogue)

| Principle | Application |
|-----------|-------------|
| Single primary symbol | Lattice mark only; no J-letter mark, no chat-window collage |
| Blue→teal family | Accent, user bubble, focus rings, selected nav |
| Structure / craft | Mark is geometric lattice; UI stays calm, not decorative |
| Fill & center | Mark optically centered in its slot; adequate size |
| OS chrome | App icons remain full-bleed square; OS applies mask |

## 5. Color tokens

Canonical file: `packages/ui/src/styles/tokens.css` (+ `tokens.spec.ts`).

### Light

| Token | Current | Target |
|-------|---------|--------|
| `--accent` | `#007aff` | `#2563eb` |
| `--info` | `#007aff` | `#2563eb` |
| `--bubble-user` | `#007aff` | `#2563eb` |
| `--accent-muted` | `#dcebff` | soft blue tint derived from `#2563eb` (e.g. `#dbeafe`) |
| `--accent-subtle` | `#e8f2ff` | e.g. `#eff6ff` |

Optional secondary (use sparingly, not as default CTA):

- `--accent-teal`: `#14b8a6` (progress / “running intelligence” accents if needed later)
- Gradients only on brand hero slots (onboarding / chat welcome), not on every button

### Dark

| Token | Current | Target |
|-------|---------|--------|
| `--accent` | `#0a84ff` | `#3b82f6` (readable on dark) |
| `--info` / `--bubble-user` | match accent | match accent |
| `--accent-muted` / `--accent-subtle` | navy-tinted | e.g. `#1e3a5f` / `#152238` family aligned with wiki navy |

Status colors (success/warning/danger/queued) stay semantic; do not recolor to teal.

**Constraint:** Keep `tokens.spec.ts` assertion that purple brand accents are forbidden.

## 6. Shared brand components

### 6.1 `JarvisMark`

- Location: `apps/desktop/src/renderer/src/components/brand/JarvisMark.tsx` (+ colocated CSS if needed).
- Source geometry: same paths as `apps/desktop/resources/icon.svg` lattice (may inline SVG; optional gradient background variant).
- Props: `size` (`sm` | `md` | `lg`), `variant` (`mark` | `app` — mark = lattice on transparent; app = full gradient tile for hero).
- Must remain crisp at 16–32px for sidebar; larger for onboarding/chat empty.

### 6.2 Wordmark

- Prefer i18n `app.title` / existing “JARVIS” strings; no new hardcoded product name in UI.
- Pair with mark in sidebar brand slot and welcome heroes.

## 7. Module coverage matrix

| Module | Brand treatment |
|--------|-----------------|
| Shell / sidebar | Wire `Sidebar` `brand` with `JarvisMark` + title; footer version line unchanged |
| Onboarding | Hero: mark (`app` or large `mark`) above existing welcome copy; step dots use `--accent` |
| Chat | Empty state: mark + wire unused `chat.welcome` / `welcomeHint`; composer unchanged |
| Agents / templates | EmptyState / list headers inherit accent; no layout change |
| Task board | Column headers / primary actions inherit tokens; empty board uses shared EmptyState pattern |
| Squad | Same token inheritance; empty / idle uses EmptyState |
| Workflow editor | Empty / idle EmptyState; selected nodes/edges keep functional colors, not forced teal |
| Canvas | EmptyState optional small mark; artifact chrome uses accent for selection/focus only |
| Office (write/PDF/composer) | Focus rings / primary buttons via tokens |
| Provider / Models | Settings forms via tokens |
| MCP / Skills | Lists + toggles via tokens |
| Settings / runtime / sandbox | Same |
| Logs / audit / token usage | Active row / links via `--accent` |
| Global search palette | Focus / highlight via tokens |
| Window / tray | Already on new icons — verify only; no change unless paths break |

Hardcoded hex that duplicates accent (e.g. orphaned sidebar grays are OK if neutral) should be migrated to tokens when they are clearly “brand accent” colors. Neutrals stay gray.

## 8. Files (expected touch list)

| Area | Paths |
|------|--------|
| Tokens | `packages/ui/src/styles/tokens.css`, `tokens.spec.ts` |
| Brand UI | `apps/desktop/.../components/brand/JarvisMark.tsx` (+ spec) |
| Shell | `AppLayout.tsx`, Sidebar usage, `desktop.css` brand slot |
| Onboarding | `OnboardingPage.tsx`, related CSS |
| Chat empty | `ChatPage.tsx` (or chat empty child), i18n already present |
| Empty states | Prefer composing existing `EmptyState` with optional `icon` slot if missing |
| Favicon | `apps/desktop/src/renderer/index.html` → link to packaged/dev icon asset |
| Tests | Update accent hex expectations; AppLayout brand tests; i18n:check if keys added |

Renderer must import pure pieces from `@jarvis/core/renderer` only if needed; brand mark stays in desktop renderer (SVG), not in `@jarvis/core`.

## 9. Testing

- Unit: token values; `JarvisMark` renders; AppLayout shows brand; Chat empty shows welcome keys when no session messages.
- Existing WindowManager / tray path specs remain green.
- `pnpm i18n:check` if any new keys (prefer reusing `chat.welcome*`).
- Manual: light/dark smoke on Chat, Task, Settings, Onboarding.

## 10. Rollout order

1. Tokens + specs (global cascade).
2. `JarvisMark` + sidebar brand.
3. Onboarding + Chat empty hero.
4. Favicon / index.html.
5. Sweep: EmptyState icon prop if needed; grep hardcoded `#007aff` / `#0a84ff` in renderer & ui packages.
6. Verify packaging icon paths unchanged.

## 11. Success criteria

- No Apple `#007aff` / `#0a84ff` as product accent in `tokens.css`.
- Sidebar and at least Onboarding + Chat empty show the lattice mark.
- Feature modules’ CTAs/selection/focus visually match logo blue family without per-module hex.
- i18n zh-CN/en remain symmetric; no purple accent regressions in tests.
