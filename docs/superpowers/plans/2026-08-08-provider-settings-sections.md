# Provider settings sections + Token copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Page title “供应商添加” / “Add Provider”; divider + “供应商列表” / “Provider list”; English secret field → Token.

**Architecture:** i18n-only for copy; `ProviderSettingsPage` + CSS for divider/list heading. No IPC/store changes.

**Tech Stack:** React, react-i18next, vitest, `@jarvis/ui` PageHeader

---

### Task 1: i18n keys

**Files:**
- Modify: `packages/i18n/locales/zh-CN/common.json`
- Modify: `packages/i18n/locales/en/common.json`

- [ ] Update `settings.provider.title`, add `listTitle`, Token copy in en (apiKey, hints, errors, description, baseUrlHint)
- [ ] `pnpm i18n:check`

### Task 2: Page layout + tests

**Files:**
- Modify: `apps/desktop/src/renderer/src/pages/settings/ProviderSettingsPage.tsx`
- Modify: `apps/desktop/src/renderer/src/styles/desktop.css`
- Modify: `apps/desktop/src/renderer/src/pages/settings/SettingsPage.spec.tsx` (and ProviderSettingsPage.spec if needed)

- [ ] Render divider + list title above cards
- [ ] Assert title / listTitle / Token label in tests
- [ ] Run targeted vitest + i18n:check
