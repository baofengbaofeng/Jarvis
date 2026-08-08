# Provider list table + edit modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Table list (name / type / models / icon actions) + edit modal matching add form with models section.

**Architecture:** Extend provider store `update`; generalize `ProviderForm` for create/edit; `DataTable` for list; modal shell in settings page; load models map for column.

**Tech Stack:** React, zustand, `@jarvis/ui` DataTable/Button/Input, vitest

---

### Task 1: Store + form edit mode

- [ ] Add `update` to provider-store (+ spec if present)
- [ ] ProviderForm accepts optional `provider` / `onDone` for edit; token optional on edit

### Task 2: Table + modal UI

- [ ] Replace cards with DataTable; edit/delete icons
- [ ] Modal with ProviderForm + ProviderModels
- [ ] i18n keys zh-CN/en; tests; i18n:check
