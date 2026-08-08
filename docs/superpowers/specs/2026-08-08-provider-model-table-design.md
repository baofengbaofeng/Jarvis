# Provider edit modal: model table + context size

## List

DataTable columns: model ID | display name | context capacity | actions (delete icon).

Empty context →「未定义」/ Undefined. Non-null `context_tokens` formatted as `NK` / `NM` when divisible by 1e3 / 1e6.

Layout: context + actions columns fixed width, header/content centered; model ID + display name share remaining width 1:1 (peer of name max length 64).

## Add row

One draft input row is shown by default. Each click of the header `+` appends another draft row (not toggle). Draft row: model ID, display name, context integer (digits only, optional), unit MenuSelect (K|M), Save. Successful save removes that draft.

Tokens stored = value × 1000 (K) or × 1_000_000 (M).

## Delete

Trash icon → confirm modal → `provider.deleteModel` (clears `agents.model_id` refs first).

## Schema

v14: `ALTER TABLE models ADD COLUMN context_tokens INTEGER;`
