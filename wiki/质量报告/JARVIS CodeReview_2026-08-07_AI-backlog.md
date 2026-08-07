# JARVIS Code Review AI Remediation Backlog

Source of truth: `wiki/质量报告/JARVIS CodeReview_2026-08-07.md`  
Do **not** use historical quality-report IDs. Track only IDs defined in the 2026-08-07 Code Review report.

## Constraints

```yaml
constraints:
  - engine_only_in_packages_core_ts
  - renderer_imports_core_renderer_only
  - protocol_no_dep_on_core
  - no_hardcoded_model_ids
  - api_keys_never_plaintext_on_disk
  - migrations_append_only
  - i18n_zh_cn_en_symmetric
  - one_commit_per_id_tdd
```

## Waves

```yaml
waves:
  - id: 0
    name: make-gates-speak
    order: [TEST-01, DESK-08, BUILD-01, BUILD-07, TEST-05]
  - id: 1
    name: security-stopgap
    order: [DESK-01, DESK-02, CORE-11, CORE-12, DESK-12, DESK-05, CORE-18, DESK-10, DESK-04, DESK-18, BUILD-06]
  - id: 2
    name: engine-correctness
    order: [CORE-01, CORE-02, CORE-03, CORE-06, CORE-05, CORE-04, CORE-19, CORE-07, CORE-20, CORE-08, CORE-09, CORE-14, CORE-17, CORE-22]
  - id: 3
    name: packaging-daemon
    order: [BUILD-02, BUILD-03, BUILD-04, DAEM-01, DAEM-04, DAEM-02, DAEM-03, DAEM-05, DAEM-11, DESK-03, DESK-09, DESK-17]
  - id: 4
    name: product-honesty
    order: [DESK-06, CORE-28, DAEM-16, CORE-15, CORE-13, DESK-23, BUILD-05, DESK-19, DESK-14, DESK-15, DESK-11, DESK-20]
  - id: 5
    name: release-evidence
    order: [TEST-02, TEST-03, TEST-04, CORE-26, DESK-26, BUILD-08]
```

## Items (priority subset — full narrative in the report)

```yaml
items:
  - id: TEST-01
    severity: critical
    status: open
    files: [apps/desktop/src/renderer/src/components/chat/MarkdownView.tsx, turbo.json]
    red: ["pnpm --dir apps/desktop build fails on oneDark named import"]
    validation: ["pnpm --dir apps/desktop build", "pnpm --dir apps/desktop vitest run"]

  - id: DESK-01
    severity: critical
    status: open
    files: [packages/core/src/approval/ApprovalGate.ts, apps/desktop/src/main/ipc/task-engine-factory.ts]
    red: ["write_file reaches ApprovalCenter.request", "run_shell echo hi reaches approval"]
    validation: ["cd packages/core && pnpm vitest run src/approval", "pnpm --dir apps/desktop vitest run src/main/ipc"]

  - id: DESK-02
    severity: critical
    status: open
    files: [apps/desktop/src/main/ipc/IpcRouter.ts, apps/desktop/src/main/ipc/tasks.ts]
    red: ["settings.set permissions.*.level=system rejected or requires approval"]
    validation: ["pnpm --dir apps/desktop vitest run src/main/ipc"]

  - id: CORE-01
    severity: critical
    status: open
    files: [packages/core/src/model/types.ts, packages/core/src/agent/AgentEngine.ts, packages/core/src/model/adapters/openai.ts, packages/core/src/model/adapters/anthropic.ts]
    red: ["second-round fetch body has tool_call_id / tool_use linkage"]
    validation: ["cd packages/core && pnpm vitest run src/model src/agent"]

  - id: CORE-02
    severity: critical
    status: open
    depends_on: [CORE-01]
    files: [packages/core/src/model/adapters/anthropic.ts]
    red: ["tool_use + input_json_delta emit tool_call chunk"]
    validation: ["cd packages/core && pnpm vitest run src/model/adapters"]

  - id: DAEM-01
    severity: critical
    status: open
    files: [packages/core/package.json, daemon/cmd/jarvis-agent/run.go, apps/desktop/src/main/daemon/DaemonSupervisor.ts]
    red: ["headless entry exists", "JARVIS_CORE_ENTRY absolute in supervisor env"]
    validation: ["test -f packages/core/dist/headless.mjs", "cd daemon && go test ./cmd/jarvis-agent/..."]

  - id: DAEM-02
    severity: critical
    status: open
    files: [daemon/internal/multica/client/handler.go, daemon/internal/runtime/queue.go]
    red: ["claim persisted before Ack", "Ack error drops job"]
    validation: ["cd daemon && go test -race ./internal/multica/client ./internal/runtime"]

  - id: BUILD-01
    severity: critical
    status: open
    files: [.github/workflows/ci.yml]
    red: ["workflow runs typecheck build test i18n go-race"]
    validation: ["test -f .github/workflows/ci.yml"]

  - id: BUILD-02
    severity: high
    status: open
    files: [apps/desktop/electron-builder.yml, apps/desktop/src/main/daemon/DaemonSupervisor.ts]
    red: ["daemon binary via extraResources / process.resourcesPath"]
    validation: ["rg -n extraResources apps/desktop/electron-builder.yml"]

  - id: BUILD-04
    severity: high
    status: open
    files: [apps/desktop/src/main/daemon/DaemonSupervisor.ts]
    red: ["win32 path ends with .exe"]
    validation: ["pnpm --dir apps/desktop vitest run src/main/daemon"]

  - id: BUILD-06
    severity: high
    status: open
    files: [apps/desktop/package.json, apps/desktop/src/main/ipc/office.ts]
    red: ["pnpm why xlsx empty", "parser bounds in utility process"]
    validation: ["pnpm why xlsx", "pnpm audit --prod"]

  - id: CORE-18
    severity: high
    status: open
    files: [packages/core/src/network/SafeHttpClient.ts, packages/core/src/model/adapters/openai.ts, packages/core/src/model/adapters/anthropic.ts]
    red: ["redirect to 169.254.169.254 rejected on chat path"]
    validation: ["cd packages/core && pnpm vitest run src/network src/model"]

  - id: CORE-19
    severity: high
    status: open
    files: [packages/core/src/agent/AgentEngine.ts, apps/desktop/src/main/ipc/tasks.ts]
    red: ["two concurrent runs keep distinct visibleTools"]
    validation: ["cd packages/core && pnpm vitest run src/agent"]

  - id: CORE-22
    severity: medium
    status: open
    files: [packages/core/src/task/TaskOrchestrator.ts, packages/core/src/agent/AgentEngine.ts]
    red: ["pause stops further model/tool calls"]
    validation: ["cd packages/core && pnpm vitest run src/task"]

  - id: DESK-05
    severity: high
    status: open
    files: [apps/desktop/src/main/external/IdeBridge.ts]
    red: ["unauthenticated /diff returns 401", "Host not 127.0.0.1 rejected"]
    validation: ["pnpm --dir apps/desktop vitest run src/main/external"]

  - id: DESK-09
    severity: high
    status: open
    files: [apps/desktop/src/main/ipc/IpcRouter.ts]
    red: ["approval request sent when window unfocused"]
    validation: ["pnpm --dir apps/desktop vitest run src/main/approval src/main/ipc"]

  - id: TEST-02
    severity: high
    status: open
    files: [test/1.0.0-Preview/suites]
    red: ["no test.skip(true) on feature-failure paths"]
    validation: ["rg -n 'test.skip\\(true' test/1.0.0-Preview/suites && exit 1 || true"]

  - id: TEST-03
    severity: high
    status: open
    files: [package.json]
    red: ["test:functional without --pass-with-no-tests"]
    validation: ["rg -n pass-with-no-tests package.json && exit 1 || true"]
```

## Protocol

1. Pick next open ID from current wave (honor `depends_on`).
2. Read the matching section in `wiki/质量报告/JARVIS CodeReview_2026-08-07.md`.
3. Write Red tests → implement → run `validation`.
4. Commit `fix|feat|test|chore({scope}): {ID} ...`
5. Set `status: fixed` here and update the report matrix note.
6. Do not start next wave until current wave Critical/High items are fixed or explicitly product-deferred in Wiki (not silently).
