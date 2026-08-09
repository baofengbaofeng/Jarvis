# Settings Provider-Parity Design

**Date:** 2026-08-09  
**Status:** Approved for implementation  
**Approach:** Shared shell + phased pages (option 1)

## 1. Goals

Align all settings menu pages with the Provider settings reference for:

- Page style / layout (`settings-page`, `PageHeader` + subtitle, `form-stack` / hints)
- Interaction (DataTable lists, Modal confirms, EnableToggle where applicable)
- Validation (required, format/range, length; client + IPC; ordered first-error)

**Out of scope for deep form parity:** Theme/Language sidebar prefs (already compact). Read-only/ops pages get shell alignment only.

## 2. Confirmed decisions

| Decision | Choice |
|----------|--------|
| Scope | **B** — form pages full parity; read-only/ops shell only |
| Lists | **A** — DataTable (not cards) |
| Enable flags | **A** — add `enabled` (+ migration) where needed; hide from runtime selection when off |
| Delivery | **A** — by nav group batches |
| Architecture | Shared FieldInput / error mapping / FIELD_MAX; reuse EnableToggle, Modal, DataTable |

## 3. Batches

| Batch | Pages | Depth |
|-------|--------|--------|
| **0** | Extract `FieldInput`, settings error helper, FIELD_MAX conventions; Provider consumes shared FieldInput | Infra |
| **1** | MCP, Skills | Full + `enabled` (migration v16) |
| **2** | Concurrency (full); Daemon / Logs (shell) | Mixed |
| **3** | Permissions, Env | Full |
| **4** | Data safety, Config import/export, Shortcuts | Full |
| **5** | Usage, Audit | Shell only |

## 4. Shared validation standard

1. Required: never silent return — show field/form error  
2. Validity: format/range on UI + IPC  
3. Length: `maxLength` + protocol constants + IPC codes  
4. Order: visual fill order, first failure wins  
5. Enable: listed in settings when disabled; filtered from runtime/selection  
6. Destructive: `Modal` + `ModalMessage` only (no `window.confirm`)  
7. i18n: zh-CN / en symmetric  

## 5. Shared components (batch 0)

- `FieldInput` — move out of `ProviderForm` into a reusable settings component  
- `mapSettingsError` / per-domain mappers — IPC code → field + i18n key  
- Domain `*_FIELD_MAX` in `@jarvis/protocol` (same shape as `PROVIDER_FIELD_MAX`)  
- Reuse existing `EnableToggle`, `Modal`, `ModalMessage`, `DataTable`, `PageHeader`, `EmptyState`

## 6. Data flow

```
input → sanitize / maxLength → client validate → IPC {ok|error}
     → main re-validate + persist → field error or refresh list
enable → setEnabled IPC → list stays; runtime filters enabled=1
delete → Modal → IPC → dependency errors via ModalMessage
```

Read-only pages: `PageHeader` + `EmptyState` + `DataTable` only.

## 7. Per-page acceptance (summary)

### MCP
- Fields: name, command, args (stdio transport)  
- Required + length + existing `MCP_*` safety  
- DataTable: name / transport / enabled / actions (test, delete)  
- `mcp_servers.enabled` DEFAULT 1; disabled not used for connections  

### Skills
- URL import: required, http(s), length; map `SKILL_*`  
- Local pick kept  
- DataTable: name / path / enabled / delete  
- `skills.enabled` DEFAULT 1; disabled not injected  

### Concurrency
- perAgent, machine: positive integers, bounds, machine ≥ perAgent  
- Visible save success/failure; daemon restart error copy  

### Permissions
- Require agent selection; enum level only; save feedback  

### Env
- Agent required; KEY=value lines validated; cliArgs length; line-level errors  

### Data safety
- Restore/wipe: Modal; wipe phrase match; structured results  

### Config import/export
- Strategy required; schema errors mapped; overwrite confirm Modal; summary result  

### Shortcuts
- Conflict detection; reject empty binding; PageHeader + table of bindings  

### Shell-only
- Daemon, Logs, Usage, Audit: PageHeader/subtitle + EmptyState consistency  

## 8. Migration

**v16:**  
`ALTER TABLE mcp_servers ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;`  
`ALTER TABLE skills ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;`  

IPC: `mcp.setEnabled`, `skills.setEnabled` (or equivalent); list-for-runtime filters enabled.

## 9. Testing

Per batch: renderer specs (validation order, maxLength, Modal, enable) + main IPC/store specs; `pnpm i18n:check`.

## 10. Non-goals

- Redesigning business semantics beyond enable/filter  
- Monaco / new settings domains  
- Changing Provider feature set (only extract shared FieldInput)
