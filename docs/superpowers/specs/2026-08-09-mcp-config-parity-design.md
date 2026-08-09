# MCP 配置全参数对齐 — Design

Date: 2026-08-09  
Status: Draft (awaiting user review)  
Branch intent: single PR / feature slice on current desktop settings work

## Goal

Make Jarvis MCP settings approach parity with mainstream desktop MCP config (Claude Desktop / Cherry / Cursor-style `mcpServers` JSON), including:

- Full **stdio** fields: command, args, cwd, env, timeout, description, enabled
- **Remote** transports: **SSE** and **streamable-http** (`http`), with url / headers / reconnect / tlsVerify
- **Security**: autoApprove, allowedTools, blockedTools (plus existing agent binding)
- **Global** MCP client settings
- **Import / export** of standard `mcpServers` JSON
- **Keychain** for secrets (no plaintext API keys in DB / export)

Provide a copy-paste **minimal dual-server sample** (filesystem + GitHub).

## Non-goals (YAGNI)

- `stdioBufferSize`, `shutdownGracePeriod`, `otelTracing`
- Dedicated MCP-only HTTP `proxy` (use existing app proxy / OS proxy as-is)
- Rewriting approval UX beyond wiring autoApprove into the existing gate
- Shipping plaintext secrets in config or export files

## Decisions (confirmed)

| Topic | Choice |
|---|---|
| Scope | Full checklist in one PR |
| Approach | Unified Jarvis model + custom transports (no MCP SDK dependency) |
| Secrets | Keychain refs only (`{ secretRef }`); never persist/export plaintext |
| Remote | Both SSE and streamable-http must connect for real |
| Agent binding | Keep `agentIds` (Jarvis-specific) |

## Current state (baseline)

- UI: name / command / args / agentIds; list + enable + test + delete; no edit
- Runtime: stdio only; spawn without cwd/env; 30s client timeout
- Schema: `transport IN ('stdio','sse','http')` already; opaque `config_json`; `enabled` (v16)
- Tools: register as `mcp:{serverName}:{tool}`; visibility by agent binding

## Data model

### Per-server (`mcp_servers`)

- Columns: `id`, `name`, `transport`, `config_json`, `enabled`, `created_at` (no new columns required if JSON holds the rest; optional `updated_at` not required)
- `config_json` shape:

```ts
type SecretOrPlain = string | { secretRef: string };

interface McpServerConfigJson {
  description?: string;
  // stdio
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, SecretOrPlain>;
  // remote
  url?: string;
  headers?: Record<string, SecretOrPlain>;
  reconnectIntervalMs?: number; // default e.g. 3000
  tlsVerify?: boolean;          // default true
  // runtime
  timeoutMs?: number;           // default 30000
  // security
  autoApprove?: string[];       // tool short names or full mcp:server:tool
  allowedTools?: string[] | null; // null/omit = all discovered
  blockedTools?: string[];
  // Jarvis
  agentIds?: string[];
}
```

- Transport mapping on import/export:
  - `stdio` ↔ `stdio`
  - `sse` ↔ `sse`
  - `http` | `streamable-http` ↔ stored as `http`
- `disabled: true` in foreign JSON ↔ `enabled = 0`

### Secret refs

- Convention: `mcp.<serverId>.env.<KEY>`, `mcp.<serverId>.header.<HeaderName>`, `mcp.global.env.<KEY>`
- Create flow: UI collects secret values → `secrets.set(ref, value)` → persist only `{ secretRef }`
- Update: empty secret UI means “keep existing”; explicit clear deletes Keychain entry
- Resolve only in main/core at connect time (memory); never write resolved values back to SQLite

### Global settings keys (allowed via settings-schema)

| Key | Type | Default |
|---|---|---|
| `mcp.auto_start` | boolean | `true` |
| `mcp.log_level` | `'error' \| 'warn' \| 'info' \| 'debug'` | `'warn'` |
| `mcp.max_concurrent_tools` | number 1–16 | `3` |
| `mcp.tool_warning_threshold` | number ≥ 1000 | `10000` |
| `mcp.global_env` | `Record<string, SecretOrPlain>` | `{}` |

## IPC / protocol

| Channel | Role |
|---|---|
| `mcp.list` | unchanged shape + richer `config` |
| `mcp.create` | accept full config; resolve/write secrets |
| `mcp.update` | **new** — patch name/transport/config/agentIds |
| `mcp.delete` | also delete related Keychain refs best-effort |
| `mcp.setEnabled` | unchanged |
| `mcp.test` | stdio + sse + http |
| `mcp.export` | `{ mcpServers, …global mirrors }` without secret plaintext |
| `mcp.import` | strategy skip/overwrite/merge (same family as config import) |

Validation extensions (`MCP_FIELD_MAX` / new limits): name, command, args, cwd, url, description lengths; env/header key counts and key name charset; timeout / reconnect ranges; tool-list entry lengths.

Command allowlist for stdio unchanged (basename allowlist or absolute path; shell metachar ban).

Remote URL: use `SafeUrlPolicy` for non-loopback hosts (HTTPS + DNS SSRF checks; Fake-IP setting applies). **MCP-only exception:** `http://` and `https://` to loopback (`127.0.0.1` / `::1` / `localhost`) are allowed for local remote MCP without requiring `JARVIS_ALLOW_LOOPBACK_URLS`, so common `http://127.0.0.1:…/sse` setups work. Non-loopback `http://` remains rejected.

## UI (Settings → MCP)

1. **Global** panel: auto_start, log_level, max_concurrent_tools, tool_warning_threshold, global_env (KV + secret toggle)
2. **Servers** DataTable: name, transport, enabled, description (truncate), actions (Edit / Test / Delete)
3. **Create / Edit Modal**:
   - transport switch → stdio vs remote fields
   - env / headers editors with secret toggle
   - timeout, description, autoApprove / allowedTools / blockedTools
   - agent bindings
4. **Import / Export / Load minimal sample** (filesystem + GitHub dual stdio servers; GitHub token as secret placeholder)

Copy: zh-CN + en under `settings.mcp.*` (extend existing tree).

## Runtime

### Stdio

`createStdioTransport(command, args, spawn, { cwd, env, onError, onClose })`  
Env merge: `process.env` subset safety ∪ resolved `global_env` ∪ resolved server `env` (server wins). Do not pass entire process.env blindly if current code did not — preserve intentional isolation except PATH/needed vars; document merge policy in plan as “inherit PATH + HOME + LANG + explicit maps”.

### SSE

JSON-RPC over SSE (client → POST messages, server → SSE event stream) matching common MCP SSE servers. Implement in `packages/core` as `createSseTransport({ url, headers, fetch/http, onError })`. All outbound URLs through `SafeHttpClient`.

### Streamable HTTP (`http`)

MCP streamable-http transport: single HTTP endpoint session. Implement `createStreamableHttpTransport` beside SSE.

### Client

- Per-server `timeoutMs` into `McpClient`
- Reconnect using `reconnectIntervalMs` for remote (bounded retries; surface last error on test)
- `tlsVerify: false` → undocumented Node insecure agent only when user set false (warn in UI)

### Tools / approval

- On register: filter by `allowedTools` / `blockedTools` (match tool short name)
- `autoApprove` entries added to approval `allowAlways` (normalize to registered tool ids `mcp:server:tool` when needed)
- Sample configs must not auto-approve write/delete/shell

### Globals

- `mcp.auto_start`: after main ready / when building agent tool registry, connect enabled bound servers; failures logged, non-fatal
- `mcp.max_concurrent_tools`: semaphore around MCP tool invocations
- `mcp.tool_warning_threshold`: if tool result string length (or char≈token heuristic) exceeds threshold, log warn at `mcp.log_level`
- `mcp.log_level`: gate MCP connection/tool logs; local only

## Minimal sample (export / “填入示例”)

Filesystem + GitHub dual stdio (user replaces token via secret UI):

```json
{
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/bf/work"],
      "cwd": "/Users/bf/work",
      "timeout": 60000,
      "autoApprove": ["list_directory", "read_file"],
      "description": "Local filesystem"
    },
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": { "secretRef": "mcp.pending.env.GITHUB_TOKEN" } },
      "description": "GitHub API"
    }
  },
  "autoStartMcp": true,
  "logLevel": "warn",
  "maxConcurrentTools": 3
}
```

On import, pending refs get reassigned to `mcp.<newId>.…` and UI prompts for missing secrets.

## Testing

- Unit: config validate/normalize, secret resolve, tool filter, import/export round-trip (no plaintext leak)
- Transport: stdio cwd/env mocks; SSE/HTTP with mocked fetch
- UI: modal transport switch, secret toggle persists ref, import sample, edit update
- i18n: `pnpm i18n:check`
- Integration: `mcp.test` succeeds path for mocked remote

## Risks

- SSE / streamable-http protocols vary by server version — pin to current MCP revision used by major desktops; document incompatibilities
- Keychain create-before-id: **insert server row first** (UUID id), then write secrets under `mcp.<id>.…`, then update config_json; on failure roll back row + secrets
- Large UI form — keep Provider/MCP FieldInput patterns; avoid second design language

## Acceptance

1. Can create/edit stdio server with cwd, env (secret), timeout, description; test spawn uses them
2. Can create/edit SSE and http remote servers with url + secret headers; test initialize + tools/list
3. autoApprove / allowedTools / blockedTools affect chat/tool path as specified
4. Global settings persist and affect auto-start / concurrency / logging
5. Import/export Claude-shaped JSON; export has no secret values
6. Minimal filesystem+GitHub sample available in UI
7. zh-CN/en symmetric; existing enable toggle + agent binding still work
