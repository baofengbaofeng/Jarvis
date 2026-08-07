# JARVIS CR AI Remediation Backlog (2026-08-07)

> Machine-oriented companion to `wiki/质量报告/JARVIS CodeReview_2026-08-07.md`.
> Agents must treat `id` as the unique tracking key. Do not mark `fixed` without validation evidence.

## Source of truth

- Review report: `wiki/质量报告/JARVIS CodeReview_2026-08-07.md`
- Design: `docs/superpowers/specs/2026-08-06-cr-remediation-design.md`
- Plans: `docs/superpowers/plans/2026-08-06-cr-*.md`

## Global constraints

```yaml
constraints:
  - engine_only_in_packages_core_ts
  - renderer_imports_core_renderer_only
  - protocol_no_dep_on_core
  - no_hardcoded_model_ids
  - api_keys_never_plaintext_on_disk
  - migrations_append_only_v13_plus
  - i18n_zh_cn_en_symmetric
  - one_commit_per_task_tdd
  - no_preview_exclusions: [local_models, offline_mode, cloud_sync, auto_update, global_shortcuts, monaco]
```

## Execution waves

```yaml
waves:
  - id: 0
    name: security-stopgap
    order: [SEC-NEW-10, SEC-NEW-11, SEC-05, SEC-03, SEC-07, SEC-06, SEC-NEW-12, SEC-02, SEC-NEW-13]
  - id: 1
    name: engine-correctness
    order: [BP-06, REQ-06, BP-05, BP-04, BP-02, BP-03, BP-01, BP-07]
  - id: 2
    name: product-closure
    order: [REQ-02, REQ-01, REQ-05, STD-05, REQ-07, REQ-08, REQ-03, REQ-04]
  - id: 3
    name: lifecycle-architecture
    order: [MAINT-01, MAINT-02, MAINT-03, MAINT-04, MAINT-05, MAINT-06, PERF-01, PERF-02, PERF-03]
  - id: 4
    name: quality-release
    order: [STD-01, STD-02, STD-03, STD-04, DOC-01, TEST-01, TEST-02, TEST-03, TEST-04, PERF-04, SEC-01, SEC-04, SEC-08, SEC-09]
```

## Items (actionable)

```yaml
items:
  - id: SEC-NEW-10
    severity: high
    status: open
    plan: docs/superpowers/plans/2026-08-06-cr-security-trust-boundary.md
    files:
      - apps/desktop/src/main/ipc/task-engine-factory.ts
      - packages/core/src/approval/ApprovalGate.ts
      - packages/core/src/sandbox/Sandbox.ts
      - packages/core/src/tools/shell.ts
    red_tests:
      - "run_shell git commit must request approval"
      - "git hooks disabled by default"
    validation:
      - "cd packages/core && pnpm vitest run src/approval src/sandbox src/tools"
      - "pnpm --dir apps/desktop vitest run src/main/ipc"

  - id: SEC-NEW-11
    severity: high
    status: open
    plan: docs/superpowers/plans/2026-08-06-cr-security-trust-boundary.md
    files:
      - apps/desktop/src/main/ipc/config.ts
      - packages/core/src/config/transfer.ts
    red_tests:
      - "import private baseUrl rejected"
      - "plaintext search apiKey not persisted"
    validation:
      - "pnpm --dir apps/desktop vitest run src/main/ipc/config"

  - id: SEC-05
    severity: high
    status: partial
    plan: docs/superpowers/plans/2026-08-06-cr-security-trust-boundary.md
    files:
      - packages/core/src/network/SafeHttpClient.ts
      - apps/desktop/src/main/security/SafeUrlPolicy.ts
      - packages/core/src/model/adapters/openai.ts
      - packages/core/src/model/adapters/anthropic.ts
      - apps/desktop/src/main/ipc/task-engine-factory.ts
      - apps/desktop/src/main/ipc/chat.ts
      - apps/desktop/src/main/ipc/office.ts
      - apps/desktop/src/main/webview/WebViewHost.ts
    red_tests:
      - "adapter redirect to 169.254.169.254 fails"
      - "webview redirect to loopback denied"
    validation:
      - "cd packages/core && pnpm vitest run src/model/adapters src/network"
      - "pnpm --dir apps/desktop vitest run src/main/security src/main/webview"

  - id: SEC-03
    severity: high
    status: open
    plan: docs/superpowers/plans/2026-08-06-cr-office-content.md
    files:
      - apps/desktop/package.json
      - apps/desktop/src/main/ipc/office.ts
    red_tests:
      - "xlsx absent from production deps"
      - "zip bomb times out in utility process"
    validation:
      - "pnpm why xlsx"
      - "pnpm audit --prod"
      - "pnpm --dir apps/desktop vitest run src/main/ipc/office"

  - id: BP-06
    severity: high
    status: open
    plan: docs/superpowers/plans/2026-08-06-cr-engine-tool-mcp.md
    files:
      - packages/core/src/model/types.ts
      - packages/core/src/agent/AgentEngine.ts
      - packages/core/src/model/adapters/openai.ts
      - packages/core/src/model/adapters/anthropic.ts
    red_tests:
      - "assistant toolCalls preserve ids"
      - "tool results reference toolCallId"
    validation:
      - "cd packages/core && pnpm vitest run src/agent src/model"

  - id: REQ-06
    severity: high
    status: open
    depends_on: [BP-06]
    plan: docs/superpowers/plans/2026-08-06-cr-engine-tool-mcp.md
    files:
      - packages/core/src/model/adapters/anthropic.ts
    red_tests:
      - "tool_use and input_json_delta streamed"
    validation:
      - "cd packages/core && pnpm vitest run src/model/adapters"

  - id: BP-05
    severity: high
    status: open
    plan: docs/superpowers/plans/2026-08-06-cr-engine-tool-mcp.md
    files:
      - packages/core/src/agent/AgentEngine.ts
      - apps/desktop/src/main/ipc/tasks.ts
      - apps/desktop/src/main/ipc/task-engine-factory.ts
    red_tests:
      - "two concurrent runs do not leak visibleTools"
    validation:
      - "cd packages/core && pnpm vitest run src/agent/AgentEngine.spec.ts"

  - id: BP-04
    severity: high
    status: open
    plan: docs/superpowers/plans/2026-08-06-cr-engine-tool-mcp.md
    files:
      - packages/core/src/mcp/McpClient.ts
      - packages/core/src/mcp/transport.ts
    red_tests:
      - "timeout rejects pending"
      - "child exit rejects pending"
    validation:
      - "cd packages/core && pnpm vitest run src/mcp"

  - id: BP-01
    severity: high
    status: open
    plan: docs/superpowers/plans/2026-08-06-cr-task-daemon-lifecycle.md
    files:
      - packages/core/src/task/CooperativeRunControl.ts
      - packages/core/src/task/TaskOrchestrator.ts
      - packages/core/src/agent/AgentEngine.ts
    red_tests:
      - "pause blocks model and tool side effects"
    validation:
      - "cd packages/core && pnpm vitest run src/task src/agent/AgentEngine.spec.ts"

  - id: BP-07
    severity: medium
    status: open
    plan: docs/superpowers/plans/2026-08-06-cr-task-daemon-lifecycle.md
    files:
      - apps/desktop/src/renderer/src/stores/task-store.ts
    red_tests:
      - "stale taskComplete for other id ignored"
    validation:
      - "pnpm --dir apps/desktop vitest run src/renderer/src/stores/task-store"

  - id: REQ-02
    severity: high
    status: open
    depends_on: [SEC-05, BP-04]
    plan: docs/superpowers/plans/2026-08-06-cr-v1-product-closure.md
    files:
      - packages/core/src/mcp/http-transport.ts
      - packages/core/src/mcp/transport.ts
      - apps/desktop/src/main/ipc/mcp.ts
      - apps/desktop/src/renderer/src/pages/settings/McpSettingsPage.tsx
    red_tests:
      - "sse and streamable-http transports"
      - "secret headers in SecureStorage only"
    validation:
      - "cd packages/core && pnpm vitest run src/mcp"
      - "pnpm i18n:check"

  - id: REQ-01
    severity: high
    status: open
    plan: docs/superpowers/plans/2026-08-06-cr-office-content.md
    files:
      - apps/desktop/src/main/ipc/office.ts
    red_tests:
      - "transcript API configured path"
      - "srt/vtt/txt fallback"
    validation:
      - "pnpm --dir apps/desktop vitest run src/main/ipc/office"

  - id: REQ-05
    severity: medium
    status: open
    plan: docs/superpowers/plans/2026-08-06-cr-office-content.md
    files:
      - packages/core/src/office/image.ts
      - apps/desktop/src/main/ipc/office.ts
    red_tests:
      - "no default dall-e-3"
      - "missing model returns stable code"
    validation:
      - "cd packages/core && pnpm vitest run src/office"
      - "rg -n 'dall-e|gpt-image' packages apps || true"

  - id: REQ-07
    severity: medium
    status: open
    plan: docs/superpowers/plans/2026-08-06-cr-v1-product-closure.md
    files:
      - apps/desktop/src/renderer/src/App.tsx
      - apps/desktop/src/renderer/src/pages/CanvasPage.tsx
    red_tests:
      - "route /canvas/:taskId resolves artifacts"
    validation:
      - "pnpm --dir apps/desktop vitest run src/renderer"

  - id: REQ-08
    severity: medium
    status: open
    plan: docs/superpowers/plans/2026-08-06-cr-v1-product-closure.md
    files:
      - apps/desktop/src/renderer/src/pages/AgentDetailPage.tsx
    red_tests:
      - "VersionHistory mounted; rollback refreshes form"
    validation:
      - "pnpm --dir apps/desktop vitest run src/renderer"

  - id: REQ-04
    severity: medium
    status: open
    plan: docs/superpowers/plans/2026-08-06-cr-v1-product-closure.md
    files:
      - docs/provider-guide.md
      - scripts/docs-links.mjs
    red_tests:
      - "docs-links check passes"
    validation:
      - "node scripts/docs-links.mjs"

  - id: MAINT-01
    severity: high
    status: open
    plan: docs/superpowers/plans/2026-08-06-cr-task-daemon-lifecycle.md
    files:
      - apps/desktop/src/main/ipc/tasks.ts
      - daemon/internal/httpapi
      - daemon/internal/taskstore
    red_tests:
      - "main does not INSERT/UPDATE tasks directly"
      - "daemon API creates/pauses/cancels"
    validation:
      - "cd daemon && go test -race ./..."
      - "pnpm --dir apps/desktop vitest run src/main/ipc/tasks src/main/daemon"

  - id: TEST-03
    severity: high
    status: open
    plan: docs/superpowers/plans/2026-08-06-cr-quality-gates.md
    files:
      - apps/desktop/e2e/s2-file-shell.spec.ts
    red_tests:
      - "no expect(true).toBe(true)"
      - "mock provider file+shell journey"
    validation:
      - "pnpm --dir apps/desktop e2e"

  - id: STD-01
    severity: medium
    status: open
    plan: docs/superpowers/plans/2026-08-06-cr-quality-gates.md
    files:
      - package.json
      - .github/workflows
    red_tests:
      - "pnpm lint exists"
      - "CI workflow runs lint typecheck unit go-race i18n build e2e audit"
    validation:
      - "pnpm lint"
      - "test -f .github/workflows/ci.yml"
```

## Agent completion protocol

1. Pick next `open|partial` item from the current wave `order` list (respect `depends_on`).
2. Open the referenced plan Task; write Red tests first.
3. Implement Green; run listed `validation` commands.
4. Commit with message `fix({scope}): {id} ...` or `feat:`/`test:` as appropriate.
5. Update this file item `status: fixed` and append evidence under a `## Evidence` section (commit hash + command output summary).
6. Update the status cell in `wiki/质量报告/JARVIS CodeReview_2026-08-07.md` matrix.
7. Do not start the next wave until the current wave's high-severity items are fixed or explicitly product-deferred in Wiki.
