# Provider settings: description + always-on add form

## Goal

Clarify what Provider management is for, and replace the header “Add Provider” button with a permanent add form.

## Layout

1. Title: matches sidebar nav (`Provider` / `Providers`)
2. Gray description under the title (`settings.provider.description`)
3. Always-visible `ProviderForm` (name, type, base URL, API key, save)
4. Existing provider cards below; no separate empty-state copy

## Behavior

- On successful create, the form clears fields so another provider can be added immediately
- Create validation and model list/delete are unchanged

## i18n

- Add `settings.provider.description` (zh-CN + en)
- Remove UI use of header add button and empty-state paragraph
