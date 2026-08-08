# Provider list table + edit modal

## Goal

Show configured providers as a four-column table; edit via a modal that matches the add form layout, with model management below the provider fields.

## List

Use `@jarvis/ui` `DataTable` under「供应商列表」:

| Name | Type | Models | Actions |
|------|------|--------|---------|
| provider.name | OpenAI / Anthropic | comma-separated display names (or modelId); `—` if none | edit + delete icon buttons |

- Delete: `window.confirm` then `provider.delete`
- Edit: open modal

## Edit modal

- Same fields/layout as add area: name, type, address, token, Cancel / Save
- Token empty = leave unchanged; non-empty = update via `provider.update`
- Below: existing model list + add model (modelId, display name) — same behavior as former card `ProviderModels`
- Title: 编辑供应商 / Edit Provider
- Close on Cancel, overlay click, or successful save; refresh list models after changes

## Create area

Unchanged; no model fields. Models are added after create via Edit.

## Out of scope

Nav label, searchProviders keys, bulk import.
