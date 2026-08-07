# Cursor-like Shell & Chat Layout Design

**Date:** 2026-08-07  
**Status:** Approved for planning  
**Scope:** Desktop renderer shell + Chat page visual/IA alignment with Cursor-style layout

## Goals

Bring JARVIS desktop UI closer to the Cursor screenshot for:

- Left sidebar structure, density, and light-gray styling
- Main Chat area (empty and active states)
- Bottom-left product identity + settings gear (no account/login chrome)
- Fixed, clickable GitHub repo link in the main-area footer

## Non-goals

- Independent Workspace entity or “default workspace directory” setting
- Changing Agent ↔ Workspace strong binding (one Agent, one workspace path)
- OS menu-bar Settings item
- Full Cursor feature parity (Automations product, cloud multitask, etc.)

## Decisions (confirmed)

| Topic | Choice |
|-------|--------|
| Approach | Full shell + Chat Cursor-like redesign (option 3) |
| Session list | Inside left shell under **CHATS** (two-column app, not three-column) |
| Language switcher | Move into Settings (Appearance / Preferences); remove from sidebar footer |
| GitHub footer URL | `https://github.com/baofengbaofeng/Jarvis` (repo home), open via system browser |
| Brand title | Already `JARVIS / {APP_VERSION}` in sidebar brand; footer repeats compact brand + gear |

## Information architecture

```
┌─────────────────────────────┬──────────────────────────────────────┐
│ JARVIS / version            │  (optional thin top context)         │
│ subtitle                    │                                      │
│                             │  Chat main                           │
│ + New Chat                  │  - empty: centered composer          │
│ ⌕ Search  (inline expand)   │  - active: narrow message column     │
│                             │    + bottom rounded composer         │
│ AGENTS                      │                                      │
│   · agent items…            │  footer: github.com/…/Jarvis (link)  │
│ CHATS                       │                                      │
│   · session items…          │                                      │
│ MORE                        │                                      │
│   Board / Coding / Office / │                                      │
│   Squad / Workflow / Canvas │                                      │
│─────────────────────────────│                                      │
│ JARVIS / version      [⚙]  │                                      │
└─────────────────────────────┴──────────────────────────────────────┘
```

### Sidebar sections

1. **Brand** — `app.title` + ` / ` + `APP_VERSION` from `@jarvis/protocol`; keep `app.subtitle`.
2. **Quick actions**
   - **New Chat** → `chatStore.newSession()` and navigate to `/`.
   - **Search** → expands to an input in the sidebar; fuzzy filter Agents and Chats by name or id (client-side). No dedicated search route in this iteration.
3. **AGENTS** — list from `agent-store`; click sets current agent and focuses Chat.
4. **CHATS** — list from `chat-store.sessions` via existing `chatListSessions` (global session list as today, not a new per-agent query); click `loadSession`. Remove the Chat page’s internal left session sidebar.
5. **MORE** — Board, Coding, Office, Squad, Workflow, Canvas, plus **Agents** management route (`/agents`) for create/edit (switching current agent uses the AGENTS list above).
6. **Footer** — compact `JARVIS / {APP_VERSION}` + gear button → `/settings` (default child e.g. providers). Remove text “Settings” nav item and sidebar `LanguageSwitcher`.

### Settings

- Add language switcher next to the existing `ThemeSwitcher` in Settings layout / Appearance area.
- Keep Cmd+, → settings shortcut.

### Main Chat

- **Empty:** vertically/horizontally centered composer card (rounded, light shadow), minimal context line (agent / workspace path if available).
- **Active:** messages in a centered narrow column; composer docked above the GitHub footer (not page-absolute over chrome).
- Preserve existing capabilities wired into composer where feasible: send, streaming, steps/plan badge — restyle, don’t drop core behavior.
- **Shell footer (all main routes):** fixed strip with muted link `github.com/baofengbaofeng/Jarvis` → `shell.openExternal` (or existing desktop open-external IPC). Constant in protocol or desktop config; i18n for accessible label if needed.

## Visual direction

- Light theme tokens: sidebar ≈ `#f0f0f0` / `#ececec`, main ≈ `#fafafa`, surfaces white, hairline borders, rounded nav active state (`~8px`), muted secondary text.
- Match density of screenshot: generous main whitespace, compact sidebar rows.
- Dark theme: keep semantic tokens; mirror structure with existing dark palette (no separate dark mock required for v1).

## Architecture / touch points

| Layer | Changes |
|-------|---------|
| `packages/ui` | Sidebar footer slot styling; optional `NavItem` icon support; shell main footer slot if missing |
| `AppLayout` | Rebuild sidebar IA; gear; search expand; chats list; remove language footer |
| `AppShell` | Optional `mainFooter` prop for GitHub strip |
| `ChatPage` | Remove inner sessions aside; empty vs active layouts; restyle composer |
| `ChatInput` | Cursor-like chrome (rounded card, send affordance) |
| Settings | Host `LanguageSwitcher` |
| `packages/protocol` | Optional `REPO_URL` / `GITHUB_REPO_URL` constant |
| i18n | Keys for New Chat, Search, Agents/Chats/More section labels, settings gear aria, repo link label (zh-CN + en) |

## Data flow

- No new SQLite tables.
- Agents / sessions continue via existing IPC + zustand stores.
- Search filters in-memory lists only.

## Error handling

- `openExternal` failure → toast or silent log (follow existing desktop pattern).
- Empty Agents/Chats → section empty state text (i18n), not broken layout.

## Testing

- `AppLayout.spec.tsx` — brand+version, gear navigates settings, no language in sidebar footer, GitHub footer present.
- `ChatPage.spec.tsx` — no inner sessions sidebar; empty composer layout testid; session switch still works via store/shell hooks as applicable.
- i18n key symmetry (`pnpm i18n:check`).
- Manual: open GitHub in system browser; language change from Settings.

## Out of scope follow-ups

- Server-side / indexed global search
- Relative timestamps on chat rows (“5m”)
- Pixel-perfect icon set parity with Cursor
- Automations / Customize as separate products
