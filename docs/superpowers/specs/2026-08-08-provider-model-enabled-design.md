# Provider / model enabled flag

## Schema (v15)

- `providers.enabled INTEGER NOT NULL DEFAULT 1`
- `models.enabled INTEGER NOT NULL DEFAULT 1`

## Settings UI

Column「是否启用」left of actions; capsule toggle (green on / gray off). Settings lists show all rows.

IPC: `provider.setEnabled`, `provider.setModelEnabled`.

## Delete provider

Reject with `PROVIDER_HAS_MODELS` if any model rows exist for that provider.

## Selection / chat

- `provider.listSelectableModels` — models where `model.enabled=1` and parent `provider.enabled=1`
- Agent model picker uses that list
- Chat send fails clearly if bound model/provider is disabled
