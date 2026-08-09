# MCP Config Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Jarvis MCP settings and runtime to desktop-standard parity (stdio full fields, SSE + streamable-http, Keychain secrets, tool gates, global MCP settings, import/export + minimal sample).

**Architecture:** Pure config normalize/validate in `packages/core`; stdio/SSE/HTTP transports beside existing `McpTransport`; main `mcp.ts` owns SQLite + Keychain resolve + IPC; renderer `McpSettingsPage` becomes global panel + DataTable + create/edit Modal (Provider-parity patterns). No `@modelcontextprotocol/sdk`.

**Tech Stack:** Electron main IPC, better-sqlite3, `@jarvis/core` MCP client, SecureStorage Keychain, React settings UI, vitest, zh-CN/en i18n.

**Spec:** `docs/superpowers/specs/2026-08-09-mcp-config-parity-design.md`

## Global Constraints

- Local-first; no telemetry; secrets never land plaintext in SQLite or export JSON
- Renderer imports `@jarvis/core/renderer` only for pure modules (put validate/normalize in a Node-free file and re-export from `renderer.ts`)
- `pnpm i18n:check` must pass for all new UI strings
- Stdio command allowlist + shell-metachar ban preserved
- Non-loopback remote URLs go through `SafeUrlPolicy`; loopback `http://` / `https://` allowed for local MCP without loopback env
- One commit per completed task: `feat:` / `test:` / `fix:` prefix
- Do not expand scope to otel / stdioBufferSize / MCP-only proxy

## File map

| Path | Responsibility |
|---|---|
| `packages/protocol/src/index.ts` | Extend `MCP_FIELD_MAX`; export shared types if needed |
| `packages/protocol/src/ipc-allowlist.ts` | `mcp.update`, `mcp.export`, `mcp.import` |
| `packages/core/src/mcp/config.ts` | Types, normalize, validate, tool filter helpers, import/export map |
| `packages/core/src/mcp/config.spec.ts` | Pure tests |
| `packages/core/src/mcp/secrets.ts` | `isSecretRef`, `resolveSecretMap` interface (resolver injected) |
| `packages/core/src/mcp/transport.ts` | stdio cwd/env; export types |
| `packages/core/src/mcp/sseTransport.ts` | SSE transport |
| `packages/core/src/mcp/httpTransport.ts` | Streamable-http transport |
| `packages/core/src/mcp/McpClient.ts` | attach any transport; timeout already exists |
| `packages/core/src/mcp/register.ts` | allowed/blocked filter; concurrency gate hook |
| `packages/core/src/mcp/toolPolicy.ts` | autoApprove / allowlist match helpers |
| `packages/core/src/renderer.ts` | Re-export pure MCP config helpers |
| `apps/desktop/src/main/ipc/mcp.ts` | Full CRUD, secrets, test all transports, import/export |
| `apps/desktop/src/main/ipc/mcp-url.ts` | Loopback http exception + SafeUrlPolicy |
| `apps/desktop/src/main/ipc/settings-schema.ts` | `mcp.*` global keys |
| `apps/desktop/src/main/ipc/IpcRouter.ts` | Register new channels; wire auto_start |
| `apps/desktop/src/renderer/.../McpSettingsPage.tsx` | Full UI |
| `packages/i18n/locales/{zh-CN,en}/common.json` | Copy |

---

### Task 1: Pure MCP config model + validation

**Files:**
- Create: `packages/core/src/mcp/config.ts`
- Create: `packages/core/src/mcp/config.spec.ts`
- Modify: `packages/protocol/src/index.ts` (`MCP_FIELD_MAX`)
- Modify: `packages/core/src/index.ts`, `packages/core/src/renderer.ts` (re-export)

**Interfaces:**
- Produces: `McpTransportKind`, `SecretOrPlain`, `McpServerConfigJson`, `normalizeMcpServerConfig(raw)`, `assertMcpServerConfig(cfg, transport)`, `MCP_FIELD_MAX` extensions (`cwd`, `url`, `description`, `envKeys`, `envValue`, `headerKeys`, `toolName`, `timeoutMsMax`)

- [ ] **Step 1: Extend `MCP_FIELD_MAX` and write failing tests**

In `packages/protocol/src/index.ts` expand:

```ts
export const MCP_FIELD_MAX = {
  name: 64,
  command: 512,
  args: 2048,
  cwd: 1024,
  url: 2048,
  description: 512,
  envKeys: 64,
  envKeyLen: 128,
  envValue: 4096,
  headerKeys: 32,
  headerKeyLen: 128,
  toolList: 128,
  toolName: 128,
  timeoutMsMax: 600_000,
} as const;
```

In `config.spec.ts` assert normalize maps `streamable-http` → storage transport `http`, coerces `timeout` → `timeoutMs`, and rejects oversized url / empty stdio command via `assertMcpServerConfig`.

- [ ] **Step 2: Run tests — expect FAIL** (module missing)

Run: `cd packages/core && pnpm vitest run src/mcp/config.spec.ts`

- [ ] **Step 3: Implement `config.ts`**

```ts
export type McpTransportKind = 'stdio' | 'sse' | 'http';
export type SecretOrPlain = string | { secretRef: string };

export interface McpServerConfigJson {
  description?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, SecretOrPlain>;
  url?: string;
  headers?: Record<string, SecretOrPlain>;
  reconnectIntervalMs?: number;
  tlsVerify?: boolean;
  timeoutMs?: number;
  autoApprove?: string[];
  allowedTools?: string[] | null;
  blockedTools?: string[];
  agentIds?: string[];
}

export function normalizeTransport(t: unknown): McpTransportKind { /* stdio|sse|http|streamable-http */ }
export function normalizeMcpServerConfig(raw: unknown): McpServerConfigJson { /* … */ }
export function assertMcpServerConfig(cfg: McpServerConfigJson, transport: McpTransportKind): void { /* throw MCP_* codes */ }
```

Defaults: `timeoutMs=30000`, `tlsVerify=true`, `reconnectIntervalMs=3000`, `args=[]`, `agentIds=[]`.

- [ ] **Step 4: Re-export from `@jarvis/core` and `@jarvis/core/renderer`; tests PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/index.ts packages/core/src/mcp/config.ts packages/core/src/mcp/config.spec.ts packages/core/src/index.ts packages/core/src/renderer.ts
git commit -m "$(cat <<'EOF'
feat: add MCP server config normalize/validate helpers

EOF
)"
```

---

### Task 2: Secret ref helpers + tool policy filter

**Files:**
- Create: `packages/core/src/mcp/secrets.ts`, `secrets.spec.ts`
- Create: `packages/core/src/mcp/toolPolicy.ts`, `toolPolicy.spec.ts`
- Modify: `packages/core/src/index.ts`, `renderer.ts`

**Interfaces:**
- Produces: `isSecretRef(v)`, `secretRefKey(v)`, `mapSecretPlainRecord(record, resolve: (ref)=>string|undefined): Record<string,string>`, `filterMcpToolNames(tools, {allowedTools, blockedTools})`, `normalizeAutoApprove(serverName, names): string[]` → `mcp:server:tool` ids

- [ ] **Step 1: Failing tests** for ref detection, resolve map, allow/block filter, autoApprove normalization

- [ ] **Step 2: Implement minimal helpers; tests PASS**

- [ ] **Step 3: Commit** `feat: add MCP secret ref and tool policy helpers`

---

### Task 3: Stdio transport `cwd` + `env`

**Files:**
- Modify: `packages/core/src/mcp/transport.ts`
- Modify: `packages/core/src/mcp/transport.spec.ts` (or create if missing)
- Modify: `packages/core/src/mcp/McpClient.ts` `createMcpClient` signature if it constructs stdio internally

**Interfaces:**
- Consumes: resolved `env: Record<string,string>`, optional `cwd`
- Produces: `createStdioTransport(command, args, spawnImpl, { cwd?, env?, onError?, onClose? })`

- [ ] **Step 1: Failing test** — mock spawnImpl captures opts; expect `cwd` and `env` passed; base env includes at least `PATH` from process when `env` provided (document: merge `pickInheritEnv()` ∪ explicit)

```ts
function pickInheritEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'USER']) {
    const v = process.env[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}
```

- [ ] **Step 2: Implement; update `createMcpClient` to accept `{ cwd, env, requestTimeoutMs }`**

- [ ] **Step 3: Commit** `feat: pass cwd and env into MCP stdio transport`

---

### Task 4: SSE transport

**Files:**
- Create: `packages/core/src/mcp/sseTransport.ts`
- Create: `packages/core/src/mcp/sseTransport.spec.ts`

**Interfaces:**
- Consumes: `SafeHttpClient` or injectable `fetchImpl`
- Produces: `createSseTransport({ url, headers, http?, onError? }): McpTransport`
- Behavior: POST JSON-RPC to message endpoint discovered from SSE `endpoint` event (MCP SSE convention); inbound SSE `message` events → `onMessage`; `close` aborts stream

- [ ] **Step 1: Failing tests** with mocked fetch/ReadableStream covering: connect, send→POST, receive message, close

- [ ] **Step 2: Implement SSE transport**

- [ ] **Step 3: Commit** `feat: add MCP SSE transport`

---

### Task 5: Streamable HTTP transport

**Files:**
- Create: `packages/core/src/mcp/httpTransport.ts`
- Create: `packages/core/src/mcp/httpTransport.spec.ts`

**Interfaces:**
- Produces: `createStreamableHttpTransport({ url, headers, http?, tlsVerify?, onError? }): McpTransport`
- Behavior: MCP streamable-http — session header if present; POST body JSON-RPC; parse SSE or JSON responses per current MCP streamable-http draft used by major clients (document the exact request/response shapes in code comments; lock with tests)

- [ ] **Step 1: Failing tests** for initialize round-trip mock

- [ ] **Step 2: Implement**

- [ ] **Step 3: Commit** `feat: add MCP streamable-http transport`

---

### Task 6: Main MCP URL policy + store create/update + Keychain

**Files:**
- Create: `apps/desktop/src/main/ipc/mcp-url.ts`, `mcp-url.spec.ts`
- Modify: `apps/desktop/src/main/ipc/mcp.ts`, `mcp.spec.ts` (or adjacent specs)
- Modify: `packages/protocol/src/ipc-allowlist.ts`
- Modify: `apps/desktop/src/main/ipc/IpcRouter.ts`

**Interfaces:**
- Consumes: Task 1–5 helpers, `SecureStorage`, `SafeUrlPolicy`
- Produces: extended `McpServerInput`; `store.update`; `resolveServerSecrets(id, cfg)`; `openMcpClientForServer(row)` attaching correct transport; `mcp.update` IPC

- [ ] **Step 1: `assertMcpRemoteUrl(url, policy)` tests** — allow `http://127.0.0.1:9000/sse`; reject `http://evil.com`; non-loopback https goes through policy

- [ ] **Step 2: Implement url helper**

- [ ] **Step 3: Extend store**

Create flow:

1. Validate name/transport/config via `assertMcpServerConfig`
2. Insert row with id
3. Persist any pending plaintext secrets from input `secretValues?: Record<string,string>` into Keychain under `mcp.<id>.…`, rewrite config to refs
4. Return server

Update: patch fields; `closeMcpClient(id)` after successful update; secret clear/keep rules from spec.

Delete: `closeMcpClient` + best-effort `secrets.delete` for known refs in config + naming prefix scan if available.

- [ ] **Step 4: Wire `openMcpClientForServer`** — merge global_env settings + server env; choose transport; `requestTimeoutMs` from config; used by `test` + `registerAgentMcpTools`

- [ ] **Step 5: Register `mcp.update`; tests PASS**

- [ ] **Step 6: Commit** `feat: MCP update IPC with Keychain and remote URL policy`

---

### Task 7: Import / export + minimal sample

**Files:**
- Modify: `packages/core/src/mcp/config.ts` (add `toClaudeMcpExport`, `fromClaudeMcpImport`)
- Modify: `apps/desktop/src/main/ipc/mcp.ts`
- Modify: `IpcRouter` + allowlist: `mcp.export`, `mcp.import`
- Create: specs for round-trip (export never contains raw secret strings)

**Interfaces:**
- Export shape: `{ mcpServers: Record<string,{…}>, autoStartMcp, logLevel, maxConcurrentTools, globalEnv? }`
- `disabled` ↔ `!enabled`; redact secrets to `{ secretRef }` or `"${secret:…}"` placeholder string — pick **object secretRef** and document
- Import strategies: `skip` | `overwrite` | `merge` (by server key/name)
- `MINIMAL_MCP_SAMPLE` constant (filesystem + github) exported for UI

- [ ] **Step 1–4: TDD import/export + sample constant; commit** `feat: MCP Claude-shaped import/export and sample`

---

### Task 8: Global settings + autoStart + concurrency + approval

**Files:**
- Modify: `settings-schema.ts` / `.spec.ts`
- Modify: `mcp/register.ts` or desktop registration path for semaphore + tool filter
- Modify: task approval wiring (`allowAlways` ∪ autoApprove)
- Modify: `IpcRouter` / main bootstrap for `mcp.auto_start`

**Settings keys:** as in spec (`mcp.auto_start`, `mcp.log_level`, `mcp.max_concurrent_tools`, `mcp.tool_warning_threshold`, `mcp.global_env`)

- [ ] **Step 1: Schema validation tests**

- [ ] **Step 2: Implement schema**

- [ ] **Step 3: Concurrency semaphore** around MCP tool handler invocations (`max_concurrent_tools`)

- [ ] **Step 4: Tool result warning** when `String(output).length > tool_warning_threshold` at configured log level

- [ ] **Step 5: autoApprove → approval allowAlways** when building agent run

- [ ] **Step 6: On registerAll (or post-ready), if `mcp.auto_start`, warm-connect enabled servers (errors logged, non-fatal)

- [ ] **Step 7: Commit** `feat: MCP global settings, auto-start, tool gates`

---

### Task 9: Settings UI overhaul + i18n

**Files:**
- Modify: `McpSettingsPage.tsx`, `McpSettingsPage.spec.tsx`
- Possibly extract: `McpServerFormModal.tsx`, `McpEnvEditor.tsx`
- Modify: `packages/i18n/locales/en/common.json`, `zh-CN/common.json`

**UI checklist:**
- Global panel bound to settings get/set
- DataTable with Edit
- Modal: transport switch; stdio vs remote fields; env/headers secret toggles calling `secretsSet` via dedicated IPC or bundled in create/update `secretValues`
- Import JSON textarea + strategy; Export download/copy; “Load sample”
- Map new `MCP_*` errors to fields

- [ ] **Step 1: Failing UI tests** for transport switch visibility, create with cwd, edit calls `mcp.update`, import sample invokes import

- [ ] **Step 2: Implement UI + i18n**

- [ ] **Step 3: `pnpm i18n:check` + vitest page specs PASS**

- [ ] **Step 4: Commit** `feat: MCP settings UI for full config parity`

---

### Task 10: Verification pass

- [ ] **Step 1: Run**  
  `cd packages/core && pnpm vitest run src/mcp`  
  `cd apps/desktop && pnpm vitest run src/main/ipc/mcp src/main/ipc/mcp-url src/main/ipc/settings-schema src/renderer/src/pages/settings/McpSettingsPage`  
  `pnpm i18n:check`

- [ ] **Step 2: Manual smoke** (dev): create stdio with env secret; enable Fake-IP if needed; add loopback SSE mock if available; toggle globals; export JSON has no plaintext token

- [ ] **Step 3: Fix any gaps from acceptance list in the spec; final commit if needed**

---

## Spec coverage checklist

| Spec item | Task |
|---|---|
| Stdio cwd/env/timeout/description | 1, 3, 6, 9 |
| SSE + streamable-http | 4, 5, 6 |
| Keychain refs | 2, 6, 9 |
| autoApprove / allowed / blocked | 2, 8, 9 |
| Global mcp.* settings | 8, 9 |
| Import/export + sample | 7, 9 |
| Loopback http exception | 6 |
| Agent binding preserved | 6, 9 |
| enabled toggle preserved | 6, 9 |

## Placeholder / consistency review

- Types use `timeoutMs` internally; import accepts Claude `timeout` alias in normalize
- Transport storage value is always `http` for streamable-http
- No TBD left in tasks; protocol shapes named consistently `McpServerConfigJson`
