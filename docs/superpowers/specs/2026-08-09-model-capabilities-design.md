# Model capabilities (max output / tools / images) — Design

Date: 2026-08-09  
Status: Approved  
Approach: Form extension + Engine-entry capability gate (option 1)  
UI mockup: Layout A (two-row draft form + capability chips in list)

## Goal

Let users configure per-Model, Zed-like capability options and enforce them at request time:

1. Max output tokens (optional)
2. Supports tools
3. Supports images

## Decisions

| Topic | Choice |
|-------|--------|
| Scope | Config + runtime enforcement |
| New-model defaults | `supportsTools=true`, `supportsImages=false`, `maxOutputTokens=null` |
| Max output empty | Omit `max_tokens` on the request; Anthropic adapter keeps its existing default when unset |
| Unsupported images | Hard fail with clear error |
| Unsupported tools | Soft prompt + continue without tools |
| Edit existing models | Supported (shared add/edit form) |
| Legacy row migration | Same defaults as new models |

## Data model

Extend `Model` / SQLite `models` (new migration v18; bump if another migration lands first):

| Field | DB column | Type | Default |
|-------|-----------|------|---------|
| `maxOutputTokens` | `max_output_tokens` | `INTEGER NULL` | `NULL` |
| `supportsTools` | `supports_tools` | `INTEGER NOT NULL` | `1` |
| `supportsImages` | `supports_images` | `INTEGER NOT NULL` | `0` |

Also:

- `SelectableModel` includes the three fields for chat/Agent gates.
- `provider.addModel` input extended; new `provider.updateModel` for edits.
- Validation: if `maxOutputTokens` is set, positive integer, upper bound aligned with existing context-token ceiling (e.g. ≤ 1e8); booleans always explicit.
- Config export: include these fields (and align export with `contextTokens` / `enabled` so model rows are not silently stripped). Import strategy changes are out of scope unless trivial.

`modelId` remains immutable on edit (avoids breaking agent/chat bindings). Display name, context, max output, and the two capability flags are editable.

## UI

Stay inside Provider → “edit models” modal (`ProviderSettingsPage`).

Shared add/edit form fields (order):

1. Model ID (read-only when editing)
2. Display name
3. Context capacity (existing K/M)
4. Max output tokens (optional number; placeholder: leave empty = unlimited / provider default)
5. Supports tools (toggle, default on)
6. Supports images (toggle, default off)

List:

- Short capability affordance (e.g. Tools / Vision markers)
- Edit action; keep enable/disable and delete
- Edit opens the same form prefilled

i18n: zh-CN and en keys symmetric under `settings.provider.*`. No separate “Advanced” collapse for this field count; mockup may refine spacing only.

## Runtime

Gate at request assembly (`AgentEngine` / chat `ChatRequest` builder), not inside `ModelRouter` and not duplicated per adapter:

| Condition | Behavior |
|-----------|----------|
| `maxOutputTokens` set | Apply as request `maxTokens` when caller did not explicitly override |
| `maxOutputTokens` null | Do not set `maxTokens` (Anthropic adapter default unchanged) |
| `supportsTools === false` | Do not inject tools; if tools would otherwise be available, show a localized in-product soft notice (chat/system-visible, not logs-only) and continue text-only |
| `supportsImages === false` and message has images | Hard fail with localized error before the provider call |
| `supportsImages === true` | Existing multimodal path unchanged |

Special cases:

- Explicit per-request `maxTokens` (e.g. diagnostic ping with `maxTokens: 1`) wins over model `maxOutputTokens`.
- Missing model metadata: safe defaults (`supportsTools=true`, `supportsImages=false`, max empty); prefer explicit failure over silent wrong multimodal sends.

## Testing

- Store/IPC: read/write new columns; `updateModel`; validation edges
- Gate unit tests: maxTokens apply/omit; tools soft-degrade; images hard-fail
- UI: defaults on add; edit prefill; list markers
- `pnpm i18n:check`

## Non-goals

- Hardcoded provider-template model capability presets (no baked-in model ids)
- Auto-detect capabilities from remote provider APIs
- Adapter-internal HTTP rewrites for gating (gate before adapters)
- Large config-import strategy redesign

## Rollout sequence (post-spec)

1. User-approved mockups of add/edit form + list markers
2. Implementation plan (`writing-plans`)
3. Code: migration → protocol/types → IPC/store → runtime gate → UI/i18n → tests
