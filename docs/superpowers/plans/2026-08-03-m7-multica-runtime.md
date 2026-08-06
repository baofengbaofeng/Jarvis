# M7 Multica Runtime 实现计划 — jarvis-agent CLI + ACP + Multica Client

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本计划依赖 M0–M6:`daemon/internal/runtime/queue.go` 与 `daemon/internal/httpapi/server.go`(M3)、`apps/desktop/src/main/db/migrations.ts`(M0,MIGRATIONS 至 v4)、main `DaemonSupervisor`(M3)、渲染层 store/i18n 框架(M0)。
>
> **覆盖能力(§10.6 M7 行)**:H1.1–H1.14、H3、L35–L36、L38–L39。Q2:A — 本机 jarvis-daemon 即 Multica Client(决策二 A 撤销),承担 Server↔Client 全部协议:注册/发现、15s 心跳、3s 轮询接单、执行、流式回传。决策一 A — Agent 引擎唯一真源为 `packages/core`(TS),jarvis-agent 为 Go 瘦协议壳,经内嵌 Node headless 进程调用同一 REACT loop,Go 侧不重写引擎。

**Goal:** 打通 Multica Runtime 路径:jarvis-agent CLI(H1.1/L35)以 ACP 兼容协议(H1.2)接收 Task 上下文(H1.3)、注入 MCP/Skills/Env(H1.6–H1.8)、以 Node headless 执行 core REACT loop(决策一 A)、流式回传(H1.4);jarvis-daemon 注册为 Multica Client(H1.10),15s 心跳 + 3s 轮询接单,经 Queue 并发(H1.11)与独立 workspace(H1.12)执行,维护 Task 生命周期(H1.13)与双向 ID 映射(L36);runtime_profiles(H1.14)与模型列表(H1.9)落地;L38 Skills/MCP 注入冲突检测与 UI、L39 运行模式指示。

**Architecture:** Go daemon 侧新增:`cmd/jarvis-agent`(cobra CLI:H1.1/L35)、`internal/db`(SQLite 访问:模型列表/运行时画像/ID 映射)、`internal/multica/acp`(ACP TaskPayload 解析 + 注入合并 + 冲突检测)、`internal/multica/client`(注册/心跳/轮询/接单/回传 Client + 冲突存储)、`internal/runtime` 扩展(WorkspacePool + StreamWriter)。jarvis-daemon 作为 Multica Client 接单后经 `AgentInvoker`(真实实现 spawn `jarvis-agent run`,Node headless 调 core)执行,流式回传。TS 侧:main 追加 migration v5(`tasks.multica_task_id` 唯一索引,L36)、`DaemonSupervisor` 轮询 runtime 状态与冲突、IPC `runtime.status`/`runtime.conflicts`/`runtime.resolveConflict`、渲染层 store;渲染层新增 ModeIndicator(L39)、RuntimeStatusView(原型 13)、SkillsMerger(L38 冲突 UI)。真实 Multica Server 互操作属 S6 联调(外部依赖),本里程碑以 httptest/fake 覆盖协议状态机。

**Tech Stack:** M0–M6 技术栈 + Go:`github.com/spf13/cobra`(CLI)、`modernc.org/sqlite`(纯 Go SQLite,跨平台无 cgo)。TS:无新增重型依赖(ModeIndicator/RuntimeStatusView/SkillsMerger 为纯组件)。

## ACP 兼容子集(Wire,H1.2/H3 — 本里程碑定义)

Multica 为外部系统,真实 Server↔Client 互操作归 S6 联调。本计划实现并单测一个 **ACP 兼容子集**(路径/字段对齐 ACP mcpServers 注入约定,H3 首选):

| Method | Path | Request → Response |
|---|---|---|
| POST | `/clients/register` | `RegisterRequest{id,name,protocol:"acp",version,concurrency,models[]}` → `RegisterResponse{clientId,heartbeatInterval,pollInterval}` |
| POST | `/clients/{id}/heartbeat` | `HeartbeatStatus{status:"idle"\|"busy",activeTasks,updatedAt}` → 200 |
| GET | `/clients/{id}/tasks` | `200 [ClaimedTask{taskId,multicaTaskId,payload}]` 或 204 无单 |
| POST | `/clients/{id}/tasks/{taskId}/ack` | `{accepted:bool}` → 200 |
| POST | `/clients/{id}/tasks/{taskId}/progress` | `StreamChunk{type:"progress",status:"running",delta,ts}` → 200 |
| POST | `/clients/{id}/tasks/{taskId}/result` | `TaskResult{status:"completed"\|"failed",result,error,model,finishedAt}` → 200 |

`jarvis-agent` 独立运行时以 JSONL 输出 `StreamChunk`(stdout),帧格式与上表 progress/result 一致(H1.4)。

## Global Constraints

(继承 M0–M6 全部约束。M7 相关复述:)

- **Q2:A Multica Client:** 本机 jarvis-daemon 即 Multica Client,承担注册/发现、15s 心跳、3s 轮询接单、执行、流式回传(决策二 A 撤销);`jarvis-agent --health` 用于连通探测(H1.10)。
- **决策一 A:** Agent 引擎唯一真源 `packages/core`(TS);jarvis-agent 为 Go 瘦协议壳,经内嵌 Node headless 调用同一 REACT loop;Go 侧不重写引擎。`NodeRunner` 的端到端验证属 S6(真实 Node + core bundle),本里程碑 Go 单测用 fake Runner 覆盖编排。
- **H1.11 并发:** 默认 6/Agent、20/机器(复用 M3 `runtime.Queue`);settings `concurrency`(C10)经 `JARVIS_CONCURRENCY_PER_AGENT`/`JARVIS_CONCURRENCY_MACHINE` 覆盖。
- **H1.12 隔离:** 每 Task 独立 workspace(`~/.jarvis/workspaces/{id}`);`WorkspacePool.Allocate()` 分配、`Cleanup()` 回收。
- **H1.13 生命周期:** queued→running→completed/failed(§8.1 FSM,复用 M3 queue 状态)。
- **L37 已移除:** 断连一律按 L34 重试/熔断,重试失败返回明确错误;无离线缓冲队列;jarvis-agent 保证断线时 Task 幂等与重试接口。
- **L36 双向映射:** `tasks.multica_task_id` 唯一索引(migration v5,TS MIGRATIONS 追加);daemon/jarvis-agent 写,main 读。
- **L38 冲突检测:** Skills/MCP 注入冲突(本地 vs Multica 下发)检测逻辑在 Go(注入发生处,`acp.MergeInjections`);冲突经 daemon `/runtime/conflicts` + IPC 送渲染层,`SkillsMerger` 提供 本地 | 下发 | 合并(改名) 三选一,决策写 settings(`multica.conflicts`,main 属主)。
- **L39 模式指示:** 三态 `local | runtime_registered | runtime_busy`,由 `registered`/`busy` 派生。
- **每表单写者(§13.3):** tasks/squads/agent_messages/audit_logs/token_usage/runtime_profiles 表归 daemon 属主。M2–M6 本地任务由 main 写;M7 起 Multica 路径由 daemon 写(runtime_profiles、`tasks.multica_task_id`)。`models` 表 main 属主,jarvis-agent 只读(`--list-models`)。`settings` 表 main 属主(冲突决策)。
- **H3 协议族:** ACP 首选对齐(mcpServers JSON 注入);M7 仅实现本计划 §Wire 子集;与真实 Multica Server 互操作归 S6 联调。
- **安全(J3):** jarvis-agent 继承沙箱;Multica 注入的 env/MCP/skills 仅作用于当前 Task workspace;日志脱敏 `sk-`/`Bearer`(J1)。
- **i18n:** M7 新增 UI(ModeIndicator/RuntimeStatusView/SkillsMerger)须 zh-CN/en 对称。
- **测试:** Go 用 `cd daemon && go test ./...`;TS 用 `cd apps/desktop && pnpm vitest run <spec>`。Go 单测使用注入的 ClientAPI/Runner/AgentInvoker/HealthChecker/WorkspaceFS,避免真实网络/Node/SQLite 文件。

## 文件结构总览(本里程碑新增)

```
daemon/
├── cmd/jarvis-agent/
│   ├── main.go                       # H1.1 CLI 组装(db 可选打开)
│   ├── cli.go                        # NewRootCmd/version/health/list-models 命令
│   ├── cli_test.go
│   ├── run.go                        # H1.3/H1.5/H1.8/H1.14/L36 run 执行流 + NodeRunner
│   ├── run_test.go
│   └── sqlite.go                     # sqliteModelLister/HistoryLoader/TaskRecorder/ProfileStore 实现
├── internal/db/
│   ├── db.go                         # H1.9/H1.14/L36:Open/ListModels/Profile/MapTaskIDs
│   └── db_test.go
├── internal/multica/
│   ├── acp/
│   │   ├── payload.go                # H1.2/H1.3 TaskPayload 解析 + initial messages
│   │   ├── payload_test.go
│   │   ├── inject.go                 # H1.6-H1.8 MergeInjections + L38 冲突检测
│   │   └── inject_test.go
│   └── client/
│       ├── client.go                 # H1.10 Client 注册/心跳/轮询/Serve
│       ├── client_test.go
│       ├── httpapi.go                # HTTPClientAPI(Wire 传输层)
│       ├── httpapi_test.go
│       ├── handler.go                # H1.10/H1.11/H1.13 ClaimHandler 接单→执行→回传
│       ├── handler_test.go
│       ├── inject.go                 # applyInjection(合并 + H1.7 skill 落盘)
│       ├── conflict.go               # ConflictStore(L38 数据)
│       ├── conflict_test.go
│       └── invoker.go                # AgentInvoker(subprocess 调 jarvis-agent)
├── internal/runtime/
│   ├── workspace.go / workspace_test.go   # H1.12 WorkspacePool
│   └── stream.go / stream_test.go         # H1.4 StreamWriter(JSONL)
├── internal/httpapi/
│   ├── server.go                     # 修改:NewServer variadic + /runtime/status /runtime/conflicts
│   └── runtime_status_test.go
└── cmd/jarvis-daemon/main.go         # 修改:组装 client/queue/pool/state/conflicts/httpapi
apps/desktop/src/main/
├── db/migrations.ts                  # 追加 v5:tasks.multica_task_id 唯一索引(L36)
├── db/migrations.spec.ts             # 断言 v5
├── daemon/DaemonSupervisor.ts        # 修改:轮询 /runtime/status + /runtime/conflicts 缓存
├── ipc/runtime.ts                    # runtime.status / runtime.conflicts / runtime.resolveConflict
└── ipc/IpcRouter.ts                  # 注册
apps/desktop/src/renderer/src/
├── stores/runtime-store.ts / spec    # RuntimeStatus + deriveMode
├── components/runtime/ModeIndicator.tsx / spec   # L39
├── components/runtime/RuntimeStatusView.tsx / spec  # L39(原型13)
├── components/runtime/SkillsMerger.tsx / spec       # L38
└── i18n resources                    # zh-CN/en runtime.* 对称
```

---

### Task 1: jarvis-agent CLI 骨架(--version/--health,H1.1/L35)

**Files:**
- Create: `daemon/cmd/jarvis-agent/main.go`
- Create: `daemon/cmd/jarvis-agent/cli.go`
- Create: `daemon/cmd/jarvis-agent/cli_test.go`

**Interfaces:**
- Consumes: 无(M3 daemon 独立 Go module)。
- Produces:
  - `const cliVersion = "0.1.0"`。
  - `VersionProvider { Version() string }`;`staticVersion string`。
  - `HealthReport { OK bool; CLIVersion string; Protocol string; NodeAvailable bool; Daemon string; Errors []string }`(json tags:ok/cliVersion/protocol/nodeAvailable/daemon/errors)。
  - `HealthChecker { Check(ctx) HealthReport }`;`defaultHealth`(探测 `node` 在 PATH,占位 daemon 探测)。
  - `NewRootCmd(out io.Writer) *cobra.Command`(SilenceUsage;version 由 `root.Version` 提供 `--version`)。
  - `NewVersionCmd(ver VersionProvider, out io.Writer)`、`NewHealthCmd(hc HealthChecker, out io.Writer)`。
  - `main.go`:组装 root + `staticVersion(cliVersion)` + `defaultHealth{cliVersion}`。
  - 命令签名占位供 Task 2(Task 6)追加:`NewListModelsCmd`、`NewRunCmd`。

- [ ] **Step 1: 添加 cobra 依赖并编写失败测试**

Run: `cd daemon && go get github.com/spf13/cobra@latest`

`daemon/cmd/jarvis-agent/cli_test.go`:
```go
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
)

type fakeVersion string

func (f fakeVersion) Version() string { return string(f) }

type fakeHealth struct{ rep HealthReport }

func (f fakeHealth) Check(context.Context) HealthReport { return f.rep }

func TestVersionCmd(t *testing.T) {
	var buf bytes.Buffer
	root := NewRootCmd(&buf)
	root.AddCommand(NewVersionCmd(fakeVersion("1.2.3"), &buf))
	root.SetArgs([]string{"version"})
	if err := root.Execute(); err != nil {
		t.Fatal(err)
	}
	if got := buf.String(); !strings.Contains(got, "1.2.3") {
		t.Fatalf("expected version in %q", got)
	}
}

func TestHealthCmdOK(t *testing.T) {
	var buf bytes.Buffer
	root := NewRootCmd(&buf)
	rep := HealthReport{OK: true, CLIVersion: "0.1.0", Protocol: "ACP", NodeAvailable: true, Daemon: "ok"}
	root.AddCommand(NewHealthCmd(fakeHealth{rep}, &buf))
	root.SetArgs([]string{"health"})
	if err := root.Execute(); err != nil {
		t.Fatal(err)
	}
	var got HealthReport
	if err := json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &got); err != nil {
		t.Fatal(err)
	}
	if !got.OK || got.Daemon != "ok" || got.Protocol != "ACP" {
		t.Fatalf("unexpected report: %+v", got)
	}
}

func TestHealthCmdFailsWhenNotOK(t *testing.T) {
	var buf bytes.Buffer
	root := NewRootCmd(&buf)
	rep := HealthReport{OK: false, CLIVersion: "0.1.0", Protocol: "ACP", NodeAvailable: false, Errors: []string{"node not found"}}
	root.AddCommand(NewHealthCmd(fakeHealth{rep}, &buf))
	root.SetArgs([]string{"health"})
	if err := root.Execute(); err == nil {
		t.Fatal("expected error when report !OK")
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd daemon && go test ./cmd/jarvis-agent/`
Expected: FAIL(编译错误,cli.go 不存在)。

- [ ] **Step 3: 编写实现**

`daemon/cmd/jarvis-agent/cli.go`:
```go
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"

	"github.com/spf13/cobra"
)

const cliVersion = "0.1.0"

// VersionProvider returns the CLI version string (H1.1/L35 --version).
type VersionProvider interface{ Version() string }

type staticVersion string

func (s staticVersion) Version() string { return string(s) }

// HealthReport is the JSON body of `jarvis-agent --health` (H1.10 连通探测).
type HealthReport struct {
	OK            bool     `json:"ok"`
	CLIVersion    string   `json:"cliVersion"`
	Protocol      string   `json:"protocol"`
	NodeAvailable bool     `json:"nodeAvailable"`
	Daemon        string   `json:"daemon,omitempty"`
	Errors        []string `json:"errors,omitempty"`
}

// HealthChecker performs the runtime connectivity probe.
type HealthChecker interface {
	Check(ctx context.Context) HealthReport
}

// defaultHealth probes the local runtime (node availability); daemon ping is
// wired when the daemon URL is known (Task 8 wiring sets env JARVIS_DAEMON_URL).
type defaultHealth struct{ cliVersion string }

func (h *defaultHealth) Check(ctx context.Context) HealthReport {
	nodeOK := exec.LookPath("node") == nil
	rep := HealthReport{OK: nodeOK, CLIVersion: h.cliVersion, Protocol: "ACP", NodeAvailable: nodeOK}
	if !nodeOK {
		rep.Errors = append(rep.Errors, "node not found in PATH")
	}
	return rep
}

// NewRootCmd builds the bare jarvis-agent CLI root. Version/health/list-models/run
// subcommands are added by main.go as dependencies become available.
func NewRootCmd(out io.Writer) *cobra.Command {
	root := &cobra.Command{
		Use:          "jarvis-agent",
		Short:        "JARVIS agent CLI — Multica ACP runtime",
		SilenceUsage: true,
	}
	root.SetOut(out)
	root.SetErr(out)
	return root
}

func NewVersionCmd(ver VersionProvider, out io.Writer) *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print the CLI version",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Fprintf(out, "jarvis-agent %s\n", ver.Version())
			return nil
		},
	}
}

func NewHealthCmd(hc HealthChecker, out io.Writer) *cobra.Command {
	return &cobra.Command{
		Use:   "health",
		Short: "Probe runtime connectivity",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			rep := hc.Check(cmd.Context())
			var buf bytes.Buffer
			if err := json.NewEncoder(&buf).Encode(rep); err != nil {
				return err
			}
			fmt.Fprint(out, buf.String())
			if !rep.OK {
				return fmt.Errorf("health check failed")
			}
			return nil
		},
	}
}
```

`daemon/cmd/jarvis-agent/main.go`:
```go
package main

import (
	"os"
)

func main() {
	out := os.Stdout
	root := NewRootCmd(out)
	root.Version = cliVersion
	root.AddCommand(NewVersionCmd(staticVersion(cliVersion), out))
	root.AddCommand(NewHealthCmd(&defaultHealth{cliVersion: cliVersion}, out))
	if err := root.Execute(); err != nil {
		os.Exit(1)
	}
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd daemon && go test ./cmd/jarvis-agent/`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add daemon/cmd/jarvis-agent/main.go daemon/cmd/jarvis-agent/cli.go daemon/cmd/jarvis-agent/cli_test.go daemon/go.mod daemon/go.sum
git commit -m "feat(multica): jarvis-agent CLI skeleton with --version/--health (H1.1/L35)"
```

---

### Task 2: SQLite 访问层 + 模型列表 + Runtime Profiles(H1.9/H1.14)

**Files:**
- Create: `daemon/internal/db/db.go`
- Create: `daemon/internal/db/db_test.go`
- Create: `daemon/cmd/jarvis-agent/sqlite.go`
- Modify: `daemon/cmd/jarvis-agent/cli.go`(追加 NewListModelsCmd),`daemon/cmd/jarvis-agent/main.go`(db 打开 + list-models)

**Interfaces:**
- Consumes: M1 `models` 表(main 属主,只读);M0 MIGRATIONS 机制。
- Produces:
  - `db.Open(path) (*sql.DB, error)` — WAL + `MaxOpenConns(1)`(§13.3 daemon 只写属主表);`ensureSchema` 建 `runtime_profiles`。
  - `db.ModelInfo { ID; ProviderID; ModelID; Name }`(json:id/providerId/modelId/name)。
  - `db.ListModels(ctx, d) ([]ModelInfo, error)` — 读 main-owned `models` 表(H1.9)。
  - `db.Profile { ID; Name; ConcurrencyPerAgent; ConcurrencyMachine; Env map[string]string }`。
  - `db.ListProfiles/GetProfile/UpsertProfile(ctx, d, ...)` — `runtime_profiles` 表(H1.14)。
  - `ModelLister { ListModels(ctx) ([]db.ModelInfo, error) }`;`sqliteModelLister`。
  - `NewListModelsCmd(lister ModelLister, out io.Writer)` — 输出 JSON 数组(`--list-models`,H1.9)。

- [ ] **Step 1: 添加 modernc 依赖并编写失败测试**

Run: `cd daemon && go get modernc.org/sqlite@latest`

`daemon/internal/db/db_test.go`:
```go
package db

import (
	"context"
	"testing"
)

func mustOpen(t *testing.T) *sql.DB {
	t.Helper()
	d, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	return d
}

func TestListModels(t *testing.T) {
	d := mustOpen(t)
	if _, err := d.Exec(`CREATE TABLE models (
		id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
		name TEXT, created_at TEXT NOT NULL
	)`); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Exec(`INSERT INTO models VALUES ('m1','prov-1','claude-sonnet-4-6','Sonnet','2026-01-01')`); err != nil {
		t.Fatal(err)
	}
	models, err := ListModels(context.Background(), d)
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 1 || models[0].ModelID != "claude-sonnet-4-6" {
		t.Fatalf("unexpected models: %+v", models)
	}
}

func TestProfileRoundTrip(t *testing.T) {
	d := mustOpen(t)
	p := Profile{ID: "dev", Name: "Development", ConcurrencyPerAgent: 2, ConcurrencyMachine: 4, Env: map[string]string{"LOG_LEVEL": "debug"}}
	if err := UpsertProfile(context.Background(), d, p); err != nil {
		t.Fatal(err)
	}
	got, err := GetProfile(context.Background(), d, "dev")
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || got.ConcurrencyPerAgent != 2 || got.Env["LOG_LEVEL"] != "debug" {
		t.Fatalf("unexpected profile: %+v", got)
	}
	all, err := ListProfiles(context.Background(), d)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 || all[0].Name != "Development" {
		t.Fatalf("unexpected profiles: %+v", all)
	}
}
```

`daemon/cmd/jarvis-agent/cli_test.go` 追加:
```go
func TestListModelsCmd(t *testing.T) {
	var buf bytes.Buffer
	root := NewRootCmd(&buf)
	root.AddCommand(NewListModelsCmd(fakeLister{models: []db.ModelInfo{{ID: "m1", ProviderID: "p1", ModelID: "claude-sonnet-4-6", Name: "Sonnet"}}}, &buf))
	root.SetArgs([]string{"list-models"})
	if err := root.Execute(); err != nil {
		t.Fatal(err)
	}
	var got []db.ModelInfo
	if err := json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ModelID != "claude-sonnet-4-6" {
		t.Fatalf("unexpected: %+v", got)
	}
}

type fakeLister struct {
	models []db.ModelInfo
	err    error
}

func (f fakeLister) ListModels(context.Context) ([]db.ModelInfo, error) { return f.models, f.err }
```

`cli_test.go` 顶部 import 追加 `"github.com/baofengbaofeng/Jarvis/daemon/internal/db"`。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd daemon && go test ./internal/db/ ./cmd/jarvis-agent/`
Expected: FAIL(db.go 不存在 / NewListModelsCmd 未定义)。

- [ ] **Step 3: 编写实现**

`daemon/internal/db/db.go`:
```go
package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	_ "modernc.org/sqlite"
)

// Open opens (and initializes if needed) the JARVIS SQLite DB. WAL + a single
// connection (§13.3): the daemon writes only its owned tables.
func Open(path string) (*sql.DB, error) {
	d, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	d.SetMaxOpenConns(1)
	if _, err := d.Exec(`PRAGMA journal_mode=WAL;`); err != nil {
		_ = d.Close()
		return nil, err
	}
	if err := ensureSchema(d); err != nil {
		_ = d.Close()
		return nil, err
	}
	return d, nil
}

func ensureSchema(d *sql.DB) error {
	_, err := d.Exec(`
		CREATE TABLE IF NOT EXISTS runtime_profiles (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			concurrency_per_agent INTEGER NOT NULL DEFAULT 6,
			concurrency_machine INTEGER NOT NULL DEFAULT 20,
			env_json TEXT NOT NULL DEFAULT '{}',
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
	`)
	return err
}

// ModelInfo is one row of the main-owned `models` table (read-only here, H1.9).
type ModelInfo struct {
	ID         string `json:"id"`
	ProviderID string `json:"providerId"`
	ModelID    string `json:"modelId"`
	Name       string `json:"name,omitempty"`
}

func ListModels(ctx context.Context, d *sql.DB) ([]ModelInfo, error) {
	rows, err := d.QueryContext(ctx,
		`SELECT m.id, m.provider_id, m.model_id, COALESCE(m.name, '') FROM models m ORDER BY m.provider_id, m.model_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ModelInfo{}
	for rows.Next() {
		var m ModelInfo
		if err := rows.Scan(&m.ID, &m.ProviderID, &m.ModelID, &m.Name); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// Profile is one runtime profile row (H1.14).
type Profile struct {
	ID                  string            `json:"id"`
	Name                string            `json:"name"`
	ConcurrencyPerAgent int               `json:"concurrencyPerAgent"`
	ConcurrencyMachine  int               `json:"concurrencyMachine"`
	Env                 map[string]string `json:"env,omitempty"`
}

func ListProfiles(ctx context.Context, d *sql.DB) ([]Profile, error) {
	rows, err := d.QueryContext(ctx,
		`SELECT id, name, concurrency_per_agent, concurrency_machine, env_json FROM runtime_profiles ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Profile{}
	for rows.Next() {
		var p Profile
		var env string
		if err := rows.Scan(&p.ID, &p.Name, &p.ConcurrencyPerAgent, &p.ConcurrencyMachine, &env); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(env), &p.Env); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func GetProfile(ctx context.Context, d *sql.DB, id string) (*Profile, error) {
	row := d.QueryRowContext(ctx,
		`SELECT id, name, concurrency_per_agent, concurrency_machine, env_json FROM runtime_profiles WHERE id = ?`, id)
	var p Profile
	var env string
	if err := row.Scan(&p.ID, &p.Name, &p.ConcurrencyPerAgent, &p.ConcurrencyMachine, &env); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if err := json.Unmarshal([]byte(env), &p.Env); err != nil {
		return nil, err
	}
	return &p, nil
}

func UpsertProfile(ctx context.Context, d *sql.DB, p Profile) error {
	env, err := json.Marshal(p.Env)
	if err != nil {
		return err
	}
	_, err = d.ExecContext(ctx, `
		INSERT INTO runtime_profiles (id, name, concurrency_per_agent, concurrency_machine, env_json)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name = excluded.name,
			concurrency_per_agent = excluded.concurrency_per_agent,
			concurrency_machine = excluded.concurrency_machine,
			env_json = excluded.env_json`,
		p.ID, p.Name, p.ConcurrencyPerAgent, p.ConcurrencyMachine, string(env))
	if err != nil {
		return fmt.Errorf("upsert profile %s: %w", p.ID, err)
	}
	return nil
}
```

`daemon/cmd/jarvis-agent/sqlite.go`:
```go
package main

import (
	"context"
	"database/sql"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/db"
)

// sqliteModelLister reads the main-owned models table for --list-models (H1.9).
type sqliteModelLister struct{ d *sql.DB }

func (s sqliteModelLister) ListModels(ctx context.Context) ([]db.ModelInfo, error) {
	return db.ListModels(ctx, s.d)
}
```

`daemon/cmd/jarvis-agent/cli.go` 追加:
```go
// ModelLister lists models available to the runtime (H1.9 --list-models).
type ModelLister interface {
	ListModels(ctx context.Context) ([]db.ModelInfo, error)
}

func NewListModelsCmd(lister ModelLister, out io.Writer) *cobra.Command {
	return &cobra.Command{
		Use:   "list-models",
		Short: "List models available to the runtime",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			if lister == nil {
				return fmt.Errorf("model lister not configured")
			}
			models, err := lister.ListModels(cmd.Context())
			if err != nil {
				return err
			}
			enc := json.NewEncoder(out)
			enc.SetIndent("", "  ")
			return enc.Encode(models)
		},
	}
}
```
(cli.go 顶部 import 追加 `"context"`、`"database/sql"` 不需要、`"github.com/baofengbaofeng/Jarvis/daemon/internal/db"`。)

`daemon/cmd/jarvis-agent/main.go`(修改):
```go
package main

import (
	"log"
	"os"
	"path/filepath"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/db"
)

func main() {
	out := os.Stdout
	root := NewRootCmd(out)
	root.Version = cliVersion
	root.AddCommand(NewVersionCmd(staticVersion(cliVersion), out))
	root.AddCommand(NewHealthCmd(&defaultHealth{cliVersion: cliVersion}, out))

	if d, err := db.Open(defaultDBPath()); err != nil {
		log.Printf("warn: open db %s: %v", defaultDBPath(), err)
	} else {
		defer d.Close()
		root.AddCommand(NewListModelsCmd(sqliteModelLister{d: d}, out))
	}

	if err := root.Execute(); err != nil {
		os.Exit(1)
	}
}

func defaultDBPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(".", ".jarvis", "jarvis.db")
	}
	return filepath.Join(home, ".jarvis", "jarvis.db")
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd daemon && go test ./internal/db/ ./cmd/jarvis-agent/`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add daemon/internal/db/db.go daemon/internal/db/db_test.go daemon/cmd/jarvis-agent/sqlite.go daemon/cmd/jarvis-agent/cli.go daemon/cmd/jarvis-agent/cli_test.go daemon/cmd/jarvis-agent/main.go daemon/go.mod daemon/go.sum
git commit -m "feat(multica): sqlite access with model list and runtime profiles (H1.9/H1.14)"
```

---

### Task 3: ACP TaskPayload 解析与初始消息(H1.2/H1.3)

**Files:**
- Create: `daemon/internal/multica/acp/payload.go`
- Create: `daemon/internal/multica/acp/payload_test.go`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `TaskPayload { TaskID; MulticaTaskID; Agent; Instruction; Context *TaskContext; MCPServers []MCPEntry; Skills []string; Env map[string]string; CLIArgs []string; Profile string; Conversation *string }`(json:taskId/multicaTaskId/agent/instruction/context/mcpServers/skills/env/cliArgs/profile/conversation)。
  - `TaskContext { Issue; Comments []string; Instruction }`(H1.3)。
  - `MCPEntry { Name; Command; Args; Env }`(H1.6,stdio)。
  - `InitialMessage { Role; Content }`。
  - `ParseTaskPayload(data) (*TaskPayload, error)` — 缺 taskId 或缺 instruction/context.instruction 报错。
  - `BuildInitialMessages(p) []InitialMessage` — issue → comments → instruction。

- [ ] **Step 1: 编写失败测试**

`daemon/internal/multica/acp/payload_test.go`:
```go
package acp

import "testing"

func TestParseTaskPayloadValid(t *testing.T) {
	data := []byte(`{"taskId":"t-1","multicaTaskId":"mt-9","instruction":"fix the bug","context":{"issue":"login broken"},"env":{"LOG":"1"}}`)
	p, err := ParseTaskPayload(data)
	if err != nil {
		t.Fatal(err)
	}
	if p.MulticaTaskID != "mt-9" || p.Instruction != "fix the bug" {
		t.Fatalf("unexpected: %+v", p)
	}
	if len(p.MCPServers) != 0 {
		t.Fatalf("no mcp expected: %+v", p.MCPServers)
	}
}

func TestParseTaskPayloadMissingTaskID(t *testing.T) {
	if _, err := ParseTaskPayload([]byte(`{"instruction":"x"}`)); err == nil {
		t.Fatal("expected error")
	}
}

func TestParseTaskPayloadMissingInstruction(t *testing.T) {
	if _, err := ParseTaskPayload([]byte(`{"taskId":"t-1"}`)); err == nil {
		t.Fatal("expected error")
	}
}

func TestParseTaskPayloadContextInstructionFallback(t *testing.T) {
	p, err := ParseTaskPayload([]byte(`{"taskId":"t-2","context":{"issue":"hi","instruction":"do it"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if p.Context == nil || p.Context.Instruction != "do it" {
		t.Fatalf("unexpected: %+v", p)
	}
}

func TestBuildInitialMessagesFromContext(t *testing.T) {
	p := &TaskPayload{
		TaskID: "t-1",
		Context: &TaskContext{Issue: "login broken", Comments: []string{"repro: step1"}, Instruction: "please fix"},
	}
	msgs := BuildInitialMessages(p)
	if len(msgs) != 3 {
		t.Fatalf("want 3 messages, got %d", len(msgs))
	}
	if msgs[0].Content != "login broken" || msgs[2].Content != "please fix" {
		t.Fatalf("unexpected: %+v", msgs)
	}
}

func TestBuildInitialMessagesInstructionOnly(t *testing.T) {
	p := &TaskPayload{TaskID: "t-3", Instruction: "run tests"}
	msgs := BuildInitialMessages(p)
	if len(msgs) != 1 || msgs[0].Content != "run tests" {
		t.Fatalf("unexpected: %+v", msgs)
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd daemon && go test ./internal/multica/acp/`
Expected: FAIL(payload.go 不存在)。

- [ ] **Step 3: 编写实现**

`daemon/internal/multica/acp/payload.go`:
```go
package acp

import (
	"encoding/json"
	"fmt"
)

// TaskPayload is the ACP-compatible task envelope received from a Multica Server.
// H1.3 接收 Task 上下文(issue/评论/指令);H1.6 mcpServers;H1.7 skills;H1.8 env/cliArgs;H1.14 profile;H1.5 conversation。
type TaskPayload struct {
	TaskID        string            `json:"taskId"`
	MulticaTaskID string            `json:"multicaTaskId"`
	Agent         string            `json:"agent,omitempty"`
	Instruction   string            `json:"instruction"`
	Context       *TaskContext      `json:"context,omitempty"`
	MCPServers    []MCPEntry        `json:"mcpServers,omitempty"`
	Skills        []string          `json:"skills,omitempty"`
	Env           map[string]string `json:"env,omitempty"`
	CLIArgs       []string          `json:"cliArgs,omitempty"`
	Profile       string            `json:"profile,omitempty"`
	Conversation  *string           `json:"conversation,omitempty"`
}

// TaskContext carries the issue/comment context the Task is attached to (H1.3).
type TaskContext struct {
	Issue       string   `json:"issue,omitempty"`
	Comments    []string `json:"comments,omitempty"`
	Instruction string   `json:"instruction,omitempty"`
}

// MCPEntry is a minimal stdio MCP server config injected by the Server (H1.6).
type MCPEntry struct {
	Name    string            `json:"name"`
	Command string            `json:"command"`
	Args    []string          `json:"args,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
}

// InitialMessage is a REACT-loop input message (role + content).
type InitialMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func ParseTaskPayload(data []byte) (*TaskPayload, error) {
	var p TaskPayload
	if err := json.Unmarshal(data, &p); err != nil {
		return nil, fmt.Errorf("parse task payload: %w", err)
	}
	if p.TaskID == "" {
		return nil, fmt.Errorf("task payload missing taskId")
	}
	if p.Instruction == "" && (p.Context == nil || p.Context.Instruction == "") {
		return nil, fmt.Errorf("task payload has no instruction or context instruction")
	}
	return &p, nil
}

// BuildInitialMessages converts a TaskPayload into the initial REACT-loop messages.
// 上下文优先级:payload.Instruction → context.Instruction;issue 为首条 user 消息;comments 依次追加(H1.3)。
func BuildInitialMessages(p *TaskPayload) []InitialMessage {
	var out []InitialMessage
	if p.Context != nil && p.Context.Issue != "" {
		out = append(out, InitialMessage{Role: "user", Content: p.Context.Issue})
	}
	if p.Context != nil {
		for _, c := range p.Context.Comments {
			if c != "" {
				out = append(out, InitialMessage{Role: "user", Content: c})
			}
		}
	}
	instr := p.Instruction
	if instr == "" && p.Context != nil {
		instr = p.Context.Instruction
	}
	if instr != "" {
		out = append(out, InitialMessage{Role: "user", Content: instr})
	}
	return out
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd daemon && go test ./internal/multica/acp/`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add daemon/internal/multica/acp/payload.go daemon/internal/multica/acp/payload_test.go
git commit -m "feat(multica): ACP task payload parser and initial messages (H1.2/H1.3)"
```

---

### Task 4: 注入合并与冲突检测(H1.6/H1.7/H1.8 逻辑 + L38 检测)

**Files:**
- Create: `daemon/internal/multica/acp/inject.go`
- Create: `daemon/internal/multica/acp/inject_test.go`

**Interfaces:**
- Consumes: Task 3 `MCPEntry`、`TaskPayload`。
- Produces:
  - `Injection { MCPServers []MCPEntry; Skills []SkillSpec; Env map[string]string; CLIArgs []string }`。
  - `SkillSpec { Source "local"|"multica"; Name; Path }`(H1.7)。
  - `SkillConflict { Name; LocalPath; MulticaPath }`、`MCPConflict { Name; LocalCommand; MulticaCommand }`(L38)。
  - `MergeInjections(local, remote Injection) (merged Injection, skillConflicts []SkillConflict, mcpConflicts []MCPConflict)` — **本地优先**(Local 在前,Multica 不覆盖同名字段/同 key env);同名冲突不进 merged,返回冲突列表由 UI 决策(L38);无冲突的 Multica 项追加。

- [ ] **Step 1: 编写失败测试**

`daemon/internal/multica/acp/inject_test.go`:
```go
package acp

import "testing"

func TestMergeInjectionLocalWinsEnvAndConflicts(t *testing.T) {
	local := Injection{
		Env:        map[string]string{"A": "local"},
		MCPServers: []MCPEntry{{Name: "fs", Command: "mcp-fs"}},
	}
	remote := Injection{
		Env:        map[string]string{"A": "remote", "B": "remote"},
		MCPServers: []MCPEntry{{Name: "fs", Command: "multica-fs"}},
	}
	merged, sc, mc := MergeInjections(local, remote)
	if merged.Env["A"] != "local" {
		t.Fatalf("local should win: %v", merged.Env)
	}
	if merged.Env["B"] != "remote" {
		t.Fatalf("remote unique key missing: %v", merged.Env)
	}
	if len(sc) != 0 {
		t.Fatalf("unexpected skill conflicts: %v", sc)
	}
	if len(mc) != 1 || mc[0].Name != "fs" || mc[0].MulticaCommand != "multica-fs" {
		t.Fatalf("unexpected mcp conflicts: %v", mc)
	}
	if len(merged.MCPServers) != 1 || merged.MCPServers[0].Command != "mcp-fs" {
		t.Fatalf("conflicting MCP should not be merged: %v", merged.MCPServers)
	}
}

func TestMergeInjectionSkillConflict(t *testing.T) {
	local := Injection{Skills: []SkillSpec{{Source: "local", Name: "review", Path: "/ws/skills/review"}}}
	remote := Injection{Skills: []SkillSpec{{Source: "multica", Name: "review", Path: "/ws/.jarvis/skills/review"}}}
	merged, sc, _ := MergeInjections(local, remote)
	if len(sc) != 1 || sc[0].Name != "review" {
		t.Fatalf("want 1 skill conflict: %v", sc)
	}
	if len(merged.Skills) != 1 || merged.Skills[0].Path != "/ws/skills/review" {
		t.Fatalf("local skill should remain: %v", merged.Skills)
	}
}

func TestMergeInjectionAppendsNonConflicting(t *testing.T) {
	local := Injection{Skills: []SkillSpec{{Source: "local", Name: "a", Path: "/a"}}}
	remote := Injection{Skills: []SkillSpec{{Source: "multica", Name: "b", Path: "/b"}}}
	merged, sc, _ := MergeInjections(local, remote)
	if len(sc) != 0 {
		t.Fatalf("no conflict expected: %v", sc)
	}
	if len(merged.Skills) != 2 {
		t.Fatalf("want both skills: %v", merged.Skills)
	}
}

func TestMergeInjectionCLIArgs(t *testing.T) {
	local := Injection{CLIArgs: []string{"--local"}}
	remote := Injection{CLIArgs: []string{"--remote-1", "--remote-2"}}
	merged, _, _ := MergeInjections(local, remote)
	if len(merged.CLIArgs) != 2 || merged.CLIArgs[0] != "--remote-1" {
		t.Fatalf("multica CLI args should be used: %v", merged.CLIArgs)
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd daemon && go test ./internal/multica/acp/`
Expected: FAIL(inject.go 不存在)。

- [ ] **Step 3: 编写实现**

`daemon/internal/multica/acp/inject.go`:
```go
package acp

import "sort"

// Injection is the merged runtime injection for a Task (H1.6–H1.8).
type Injection struct {
	MCPServers []MCPEntry            `json:"mcpServers"`
	Skills     []SkillSpec           `json:"skills"`
	Env        map[string]string     `json:"env"`
	CLIArgs    []string              `json:"cliArgs"`
}

// SkillSpec is a Skill reference: local workspace dir or Multica-injected dir (H1.7).
type SkillSpec struct {
	Source string `json:"source"` // "local" | "multica"
	Name   string `json:"name"`
	Path   string `json:"path"`
}

// SkillConflict is one name collision between a local and a Multica skill (L38).
type SkillConflict struct {
	Name        string `json:"name"`
	LocalPath   string `json:"localPath,omitempty"`
	MulticaPath string `json:"multicaPath,omitempty"`
}

// MCPConflict is one name collision between a local and a Multica MCP server (L38).
type MCPConflict struct {
	Name           string `json:"name"`
	LocalCommand   string `json:"localCommand,omitempty"`
	MulticaCommand string `json:"multicaCommand,omitempty"`
}

// MergeInjections merges local and Multica injections. 本地优先(Local 在前,Multica 不覆盖);
// 同名冲突不进 merged,返回冲突列表由 UI 决策(L38);无冲突的 Multica 项追加。
func MergeInjections(local, remote Injection) (Injection, []SkillConflict, []MCPConflict) {
	merged := Injection{
		MCPServers: append([]MCPEntry{}, local.MCPServers...),
		Skills:     append([]SkillSpec{}, local.Skills...),
		Env:        map[string]string{},
		CLIArgs:    append([]string{}, remote.CLIArgs...),
	}
	for k, v := range local.Env {
		merged.Env[k] = v
	}
	for k, v := range remote.Env {
		if _, ok := merged.Env[k]; !ok {
			merged.Env[k] = v
		}
	}

	localMcp := map[string]MCPEntry{}
	for _, m := range local.MCPServers {
		localMcp[m.Name] = m
	}
	localSkill := map[string]SkillSpec{}
	for _, s := range local.Skills {
		localSkill[s.Name] = s
	}

	var sc []SkillConflict
	for _, r := range remote.Skills {
		if ls, ok := localSkill[r.Name]; ok {
			sc = append(sc, SkillConflict{Name: r.Name, LocalPath: ls.Path, MulticaPath: r.Path})
		} else {
			merged.Skills = append(merged.Skills, r)
		}
	}
	var mc []MCPConflict
	for _, r := range remote.MCPServers {
		if lm, ok := localMcp[r.Name]; ok {
			mc = append(mc, MCPConflict{Name: r.Name, LocalCommand: lm.Command, MulticaCommand: r.Command})
		} else {
			merged.MCPServers = append(merged.MCPServers, r)
		}
	}
	sort.Slice(merged.Skills, func(i, j int) bool { return merged.Skills[i].Name < merged.Skills[j].Name })
	sort.Slice(merged.MCPServers, func(i, j int) bool { return merged.MCPServers[i].Name < merged.MCPServers[j].Name })
	return merged, sc, mc
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd daemon && go test ./internal/multica/acp/`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add daemon/internal/multica/acp/inject.go daemon/internal/multica/acp/inject_test.go
git commit -m "feat(multica): injection merge with local-wins and L38 conflict detection (H1.6-H1.8)"
```

---

### Task 5: WorkspacePool + StreamWriter(H1.12/H1.4)

**Files:**
- Create: `daemon/internal/runtime/workspace.go`
- Create: `daemon/internal/runtime/workspace_test.go`
- Create: `daemon/internal/runtime/stream.go`
- Create: `daemon/internal/runtime/stream_test.go`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `WorkspaceFS { MkdirAll(path, perm); RemoveAll(path); Stat(path) }`;`defaultFS`。
  - `WorkspacePool { Allocate(taskID) (string, error); Cleanup(taskID) error }` — `NewWorkspacePool(root)` / `NewWorkspacePoolFS(root, fs)`;目录 `root/{taskID}`(H1.12)。
  - `StreamChunk { Type "progress"|"result"; TaskID; Status running|completed|failed; Delta; Result; Error; Model; TS }`(json:type/taskId/status/delta/result/error/model/ts,H1.4)。
  - `StreamWriter { Progress(taskID, status, delta) error; Result(taskID, status, result, model, errMsg) error }` — JSONL 帧到 `io.Writer`(jarvis-agent stdout / daemon→Server)。

- [ ] **Step 1: 编写失败测试**

`daemon/internal/runtime/workspace_test.go`:
```go
package runtime

import (
	"os"
	"path/filepath"
	"testing"
)

type memFS struct {
	dirs    map[string]bool
	removed map[string]bool
}

func (m *memFS) MkdirAll(p string, _ os.FileMode) error {
	m.dirs[p] = true
	return nil
}

func (m *memFS) RemoveAll(p string) error {
	m.removed[p] = true
	delete(m.dirs, p)
	return nil
}

func (m *memFS) Stat(p string) (os.FileInfo, error) {
	if m.dirs[p] {
		return nil, nil
	}
	return nil, os.ErrNotExist
}

func TestWorkspaceAllocateAndCleanup(t *testing.T) {
	fs := &memFS{dirs: map[string]bool{}, removed: map[string]bool{}}
	pool := NewWorkspacePoolFS("/ws", fs)
	dir, err := pool.Allocate("task-1")
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join("/ws", "task-1")
	if dir != want {
		t.Fatalf("want %s got %s", want, dir)
	}
	if !fs.dirs[want] {
		t.Fatalf("dir not created")
	}
	if err := pool.Cleanup("task-1"); err != nil {
		t.Fatal(err)
	}
	if !fs.removed[want] {
		t.Fatalf("dir not removed")
	}
}

func TestWorkspaceAllocateEmptyID(t *testing.T) {
	pool := NewWorkspacePool("/ws")
	if _, err := pool.Allocate(""); err == nil {
		t.Fatal("expected error")
	}
}
```

`daemon/internal/runtime/stream_test.go`:
```go
package runtime

import (
	"bufio"
	"bytes"
	"strings"
	"testing"
)

func TestStreamWriterJSONL(t *testing.T) {
	var buf bytes.Buffer
	sw := NewStreamWriter(&buf)
	if err := sw.Progress("t-1", "running", "fixing..."); err != nil {
		t.Fatal(err)
	}
	if err := sw.Result("t-1", "completed", "done", "claude-sonnet-4-6", ""); err != nil {
		t.Fatal(err)
	}

	sc := bufio.NewScanner(strings.NewReader(buf.String()))
	lines := []string{}
	for sc.Scan() {
		lines = append(lines, sc.Text())
	}
	if len(lines) != 2 {
		t.Fatalf("want 2 lines, got %d: %q", len(lines), buf.String())
	}
	if !strings.Contains(lines[0], `"type":"progress"`) {
		t.Fatalf("bad line0: %s", lines[0])
	}
	if !strings.Contains(lines[1], `"type":"result"`) {
		t.Fatalf("bad line1: %s", lines[1])
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd daemon && go test ./internal/runtime/`
Expected: FAIL(workspace.go/stream.go 不存在)。

- [ ] **Step 3: 编写实现**

`daemon/internal/runtime/workspace.go`:
```go
package runtime

import (
	"fmt"
	"os"
	"path/filepath"
)

// WorkspacePool allocates per-task isolated directories under root (H1.12).
type WorkspacePool struct {
	root string
	fs   WorkspaceFS
}

// WorkspaceFS abstracts filesystem ops for testability.
type WorkspaceFS interface {
	MkdirAll(path string, perm os.FileMode) error
	RemoveAll(path string) error
	Stat(path string) (os.FileInfo, error)
}

type defaultFS struct{}

func (defaultFS) MkdirAll(p string, m os.FileMode) error { return os.MkdirAll(p, m) }
func (defaultFS) RemoveAll(p string) error               { return os.RemoveAll(p) }
func (defaultFS) Stat(p string) (os.FileInfo, error)     { return os.Stat(p) }

func NewWorkspacePool(root string) *WorkspacePool {
	return NewWorkspacePoolFS(root, defaultFS{})
}

func NewWorkspacePoolFS(root string, fs WorkspaceFS) *WorkspacePool {
	return &WorkspacePool{root: root, fs: fs}
}

// Allocate creates (or reuses) the isolated directory for taskID and returns its abs path.
func (p *WorkspacePool) Allocate(taskID string) (string, error) {
	if taskID == "" {
		return "", fmt.Errorf("workspace: empty task id")
	}
	dir := filepath.Join(p.root, taskID)
	if err := p.fs.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("workspace allocate %s: %w", taskID, err)
	}
	return dir, nil
}

// Cleanup removes the isolated directory for taskID.
func (p *WorkspacePool) Cleanup(taskID string) error {
	if taskID == "" {
		return nil
	}
	return p.fs.RemoveAll(filepath.Join(p.root, taskID))
}
```

`daemon/internal/runtime/stream.go`:
```go
package runtime

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"time"
)

// StreamChunk is one JSONL frame pushed to the consumer (H1.4).
type StreamChunk struct {
	Type   string `json:"type"` // "progress" | "result"
	TaskID string `json:"taskId"`
	Status string `json:"status"` // running | completed | failed
	Delta  string `json:"delta,omitempty"`
	Result string `json:"result,omitempty"`
	Error  string `json:"error,omitempty"`
	Model  string `json:"model,omitempty"`
	TS     int64  `json:"ts"`
}

// StreamWriter writes JSONL frames to w (jarvis-agent stdout / daemon→Server).
type StreamWriter struct {
	w   *bufio.Writer
	enc *json.Encoder
}

func NewStreamWriter(w io.Writer) *StreamWriter {
	bw := bufio.NewWriter(w)
	return &StreamWriter{w: bw, enc: json.NewEncoder(bw)}
}

func (s *StreamWriter) Progress(taskID, status, delta string) error {
	return s.emit(StreamChunk{Type: "progress", TaskID: taskID, Status: status, Delta: delta, TS: time.Now().Unix()})
}

func (s *StreamWriter) Result(taskID, status, result, model, errMsg string) error {
	return s.emit(StreamChunk{Type: "result", TaskID: taskID, Status: status, Result: result, Model: model, Error: errMsg, TS: time.Now().Unix()})
}

func (s *StreamWriter) emit(c StreamChunk) error {
	if err := s.enc.Encode(c); err != nil {
		return fmt.Errorf("stream emit: %w", err)
	}
	return s.w.Flush()
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd daemon && go test ./internal/runtime/`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add daemon/internal/runtime/workspace.go daemon/internal/runtime/workspace_test.go daemon/internal/runtime/stream.go daemon/internal/runtime/stream_test.go
git commit -m "feat(multica): per-task workspace pool and JSONL stream writer (H1.12/H1.4)"
```

---

### Task 6: jarvis-agent run 执行流 + ID 映射(H1.3/H1.5/H1.8/H1.14/L36)

**Files:**
- Create: `daemon/cmd/jarvis-agent/run.go`
- Create: `daemon/cmd/jarvis-agent/run_test.go`
- Create: `daemon/cmd/jarvis-agent/sqlite.go`(修改:追加 sqliteHistoryLoader/sqliteTaskRecorder/sqliteProfileStore)
- Modify: `daemon/internal/db/db.go`(追加 MapTaskIDs/MulticaTaskIDByLocal)
- Modify: `daemon/cmd/jarvis-agent/cli.go`(NewRunCmd),`daemon/cmd/jarvis-agent/main.go`
- Modify: `apps/desktop/src/main/db/migrations.ts`(追加 v5),Create: `apps/desktop/src/main/db/migrations.spec.ts`

**Interfaces:**
- Consumes: Task 2 `db`(Profile/MapTaskIDs)、Task 3 `acp`、Task 5 `runtime.WorkspacePool`/`StreamWriter`。
- Produces:
  - `RunSpec { Agent; Model; Profile; Workspace; InitialMessages []acp.InitialMessage; Injection acp.Injection; Env map[string]string }`。
  - `RunResult { Result; Model; Status "completed"|"failed"; Error }`。
  - `Runner { Run(ctx, spec) (RunResult, error) }`;`NodeRunner`(内嵌 Node headless 跑 core,决策一 A;端到端属 S6)。
  - `HistoryLoader { Load(ctx, conversationID) ([]acp.InitialMessage, error) }`(H1.5)。
  - `TaskRecorder { Record(ctx, localTaskID, multicaTaskID) error }`(L36)。
  - `ProfileStore { Get(ctx, id) (*db.Profile, error) }`(H1.14)。
  - `RunDeps { Runner; History; Recorder; Pool; Profiles }`;`TaskOpts { LocalTaskID }`。
  - `ExecuteTask(ctx, deps, payload, opts, stream) error` — 编排:初始消息 → 会话历史(H1.5)→ profile env(H1.14)→ 注入合并(H1.6-H1.8,consume Task 4)→ workspace(H1.12)→ Runner → 流式回传(H1.4)→ ID 映射(L36)。
  - `NewRunCmd(deps RunDeps, out io.Writer)` — flags `--task`(payload JSON 路径,默认 stdin)、`--local-task-id`。
  - migration v5:`tasks` 加 `multica_task_id TEXT` + `CREATE UNIQUE INDEX ... WHERE multica_task_id IS NOT NULL`(L36)。

- [ ] **Step 1: 追加 v5 迁移并断言**

`apps/desktop/src/main/db/migrations.ts` 的 `MIGRATIONS` 数组末尾追加:
```ts
{
  version: 5,
  sql: `ALTER TABLE tasks ADD COLUMN multica_task_id TEXT;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_multica_task_id ON tasks(multica_task_id) WHERE multica_task_id IS NOT NULL;`
}
```

`apps/desktop/src/main/db/migrations.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { MIGRATIONS } from './migrations';

describe('migration v5 (L36)', () => {
  it('adds tasks.multica_task_id with a unique index', () => {
    const v5 = MIGRATIONS.find((m) => m.version === 5);
    expect(v5).toBeDefined();
    expect(v5!.sql).toContain('multica_task_id');
    expect(v5!.sql).toContain('UNIQUE INDEX');
  });
});
```

`daemon/internal/db/db.go` 追加:
```go
// MapTaskIDs links a local task to its Multica task id (L36).
func MapTaskIDs(ctx context.Context, d *sql.DB, localTaskID, multicaTaskID string) error {
	if multicaTaskID == "" {
		return nil
	}
	_, err := d.ExecContext(ctx,
		`UPDATE tasks SET multica_task_id = ? WHERE id = ?`, multicaTaskID, localTaskID)
	if err != nil {
		return fmt.Errorf("map task ids %s->%s: %w", localTaskID, multicaTaskID, err)
	}
	return nil
}

// MulticaTaskIDByLocal resolves a Multica task id from a local task id.
func MulticaTaskIDByLocal(ctx context.Context, d *sql.DB, localTaskID string) (string, error) {
	var id sql.NullString
	err := d.QueryRowContext(ctx, `SELECT multica_task_id FROM tasks WHERE id = ?`, localTaskID).Scan(&id)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", nil
		}
		return "", err
	}
	return id.String, nil
}
```

- [ ] **Step 2: 编写失败测试**

`daemon/cmd/jarvis-agent/run_test.go`:
```go
package main

import (
	"bytes"
	"context"
	"errors"
	"testing"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/db"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/acp"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"
)

type fakeRunner struct {
	specs []RunSpec
	res   RunResult
	err   error
}

func (f *fakeRunner) Run(_ context.Context, spec RunSpec) (RunResult, error) {
	f.specs = append(f.specs, spec)
	return f.res, f.err
}

type fakeHistory struct{ msgs []acp.InitialMessage }

func (f *fakeHistory) Load(context.Context, string) ([]acp.InitialMessage, error) { return f.msgs, nil }

type fakeRecorder struct {
	calls [][2]string
}

func (f *fakeRecorder) Record(_ context.Context, local, multica string) error {
	f.calls = append(f.calls, [2]string{local, multica})
	return nil
}

type fakeProfiles struct{ prof *db.Profile }

func (f *fakeProfiles) Get(context.Context, string) (*db.Profile, error) { return f.prof, nil }

func testDeps(runner Runner, history HistoryLoader, rec TaskRecorder, prof ProfileStore) (RunDeps, *runtime.WorkspacePool) {
	fs := &memPoolFS{}
	pool := runtime.NewWorkspacePoolFS("/ws", fs)
	return RunDeps{Runner: runner, History: history, Recorder: rec, Pool: pool, Profiles: prof}, pool
}

func TestExecuteTaskStreamsAndRecordsMapping(t *testing.T) {
	runner := &fakeRunner{res: RunResult{Status: "completed", Result: "done", Model: "m1"}}
	rec := &fakeRecorder{}
	deps, _ := testDeps(runner, &fakeHistory{}, rec, &fakeProfiles{})
	var buf bytes.Buffer
	sw := runtime.NewStreamWriter(&buf)

	payload := &acp.TaskPayload{TaskID: "t-1", MulticaTaskID: "mt-1", Instruction: "fix it"}
	opts := TaskOpts{LocalTaskID: "local-1"}
	if err := ExecuteTask(context.Background(), deps, payload, opts, sw); err != nil {
		t.Fatal(err)
	}
	if len(runner.specs) != 1 || runner.specs[0].Workspace == "" {
		t.Fatalf("runner not invoked correctly: %+v", runner.specs)
	}
	if len(rec.calls) != 1 || rec.calls[0] != [2]string{"local-1", "mt-1"} {
		t.Fatalf("mapping not recorded: %v", rec.calls)
	}
	if !bytes.Contains(buf.Bytes(), []byte(`"type":"result"`)) {
		t.Fatalf("no result frame: %s", buf.String())
	}
}

func TestExecuteTaskPrependsHistory(t *testing.T) {
	runner := &fakeRunner{res: RunResult{Status: "completed", Result: "ok"}}
	deps, _ := testDeps(runner, &fakeHistory{msgs: []acp.InitialMessage{{Role: "user", Content: "prior"}}}, &fakeRecorder{}, &fakeProfiles{})
	var buf bytes.Buffer
	conv := "conv-9"
	payload := &acp.TaskPayload{TaskID: "t-2", Instruction: "now", Conversation: &conv}
	if err := ExecuteTask(context.Background(), deps, payload, TaskOpts{}, runtime.NewStreamWriter(&buf)); err != nil {
		t.Fatal(err)
	}
	if len(runner.specs[0].InitialMessages) != 2 || runner.specs[0].InitialMessages[0].Content != "prior" {
		t.Fatalf("history not prepended: %+v", runner.specs[0].InitialMessages)
	}
}

func TestExecuteTaskAppliesProfileEnv(t *testing.T) {
	runner := &fakeRunner{res: RunResult{Status: "completed", Result: "ok"}}
	prof := &db.Profile{ID: "dev", Env: map[string]string{"LOG_LEVEL": "debug"}}
	deps, _ := testDeps(runner, &fakeHistory{}, &fakeRecorder{}, &fakeProfiles{prof: prof})
	var buf bytes.Buffer
	payload := &acp.TaskPayload{TaskID: "t-3", Instruction: "go", Profile: "dev"}
	if err := ExecuteTask(context.Background(), deps, payload, TaskOpts{}, runtime.NewStreamWriter(&buf)); err != nil {
		t.Fatal(err)
	}
	if runner.specs[0].Env["LOG_LEVEL"] != "debug" {
		t.Fatalf("profile env missing: %+v", runner.specs[0].Env)
	}
}

func TestExecuteTaskRunnerErrorStreamsFailed(t *testing.T) {
	runner := &fakeRunner{err: errors.New("boom")}
	deps, _ := testDeps(runner, &fakeHistory{}, &fakeRecorder{}, &fakeProfiles{})
	var buf bytes.Buffer
	sw := runtime.NewStreamWriter(&buf)
	payload := &acp.TaskPayload{TaskID: "t-4", Instruction: "go"}
	if err := ExecuteTask(context.Background(), deps, payload, TaskOpts{}, sw); err == nil {
		t.Fatal("expected error from runner")
	}
	if !bytes.Contains(buf.Bytes(), []byte(`"status":"failed"`)) {
		t.Fatalf("no failed frame: %s", buf.String())
	}
}

// memPoolFS implements runtime.WorkspaceFS in-memory.
type memPoolFS struct{}

func (m *memPoolFS) MkdirAll(string, os.FileMode) error { return nil }
func (m *memPoolFS) RemoveAll(string) error             { return nil }
func (m *memPoolFS) Stat(string) (os.FileInfo, error)   { return nil, nil }
```

run_test.go 顶部 import 追加 `"os"`。

- [ ] **Step 3: 运行测试确认失败**

Run: `cd daemon && go test ./cmd/jarvis-agent/ && cd apps/desktop && pnpm vitest run src/main/db/migrations.spec.ts`
Expected: FAIL(run.go 不存在 / v5 迁移缺失)。

- [ ] **Step 4: 编写实现**

`daemon/cmd/jarvis-agent/run.go`:
```go
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/db"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/acp"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"
	"github.com/spf13/cobra"
)

// RunSpec is the merged per-task execution spec handed to the core REACT loop.
type RunSpec struct {
	Agent           string                `json:"agent,omitempty"`
	Model           string                `json:"model,omitempty"`
	Profile         string                `json:"profile,omitempty"`
	Workspace       string                `json:"workspace"`
	InitialMessages []acp.InitialMessage  `json:"initialMessages"`
	Injection       acp.Injection         `json:"injection"`
	Env             map[string]string     `json:"env,omitempty"`
}

// RunResult is the final outcome of a task execution.
type RunResult struct {
	Result string `json:"result"`
	Model  string `json:"model,omitempty"`
	Status string `json:"status"` // completed | failed
	Error  string `json:"error,omitempty"`
}

// Runner executes the REACT loop. 真实实现 NodeRunner 内嵌 Node headless 跑 core(决策一 A);
// 单测使用 fake(端到端属 S6 联调)。
type Runner interface {
	Run(ctx context.Context, spec RunSpec) (RunResult, error)
}

// HistoryLoader loads a prior conversation by uuid (H1.5 --conversation).
type HistoryLoader interface {
	Load(ctx context.Context, conversationID string) ([]acp.InitialMessage, error)
}

// TaskRecorder persists the local<->multica task id mapping (L36).
type TaskRecorder interface {
	Record(ctx context.Context, localTaskID, multicaTaskID string) error
}

// ProfileStore loads a runtime profile by id (H1.14).
type ProfileStore interface {
	Get(ctx context.Context, id string) (*db.Profile, error)
}

// RunDeps are the injected dependencies of the `run` command.
type RunDeps struct {
	Runner   Runner
	History  HistoryLoader
	Recorder TaskRecorder
	Pool     *runtime.WorkspacePool
	Profiles ProfileStore
}

// TaskOpts are the command-level options for one execution.
type TaskOpts struct {
	LocalTaskID string
}

// ExecuteTask orchestrates one ACP task: history (H1.5) -> profile (H1.14) ->
// injection merge (H1.6-H1.8) -> workspace (H1.12) -> REACT loop -> stream (H1.4)
// -> id mapping (L36)。
func ExecuteTask(ctx context.Context, deps RunDeps, payload *acp.TaskPayload, opts TaskOpts, stream *runtime.StreamWriter) error {
	msgs := acp.BuildInitialMessages(payload)

	if payload.Conversation != nil && *payload.Conversation != "" {
		hist, err := deps.History.Load(ctx, *payload.Conversation)
		if err != nil {
			return fmt.Errorf("load conversation %s: %w", *payload.Conversation, err)
		}
		msgs = append(hist, msgs...)
	}

	env := map[string]string{}
	if payload.Profile != "" {
		prof, err := deps.Profiles.Get(ctx, payload.Profile)
		if err != nil {
			return fmt.Errorf("load profile %s: %w", payload.Profile, err)
		}
		if prof != nil {
			for k, v := range prof.Env {
				if _, ok := env[k]; !ok {
					env[k] = v
				}
			}
		}
	}
	for k, v := range payload.Env {
		if _, ok := env[k]; !ok {
			env[k] = v
		}
	}

	local := acp.Injection{Env: env}
	merged, _, _ := acp.MergeInjections(local, acp.Injection{
		MCPServers: payload.MCPServers,
		Env:        payload.Env,
		CLIArgs:    payload.CLIArgs,
	})

	ws, err := deps.Pool.Allocate(payload.TaskID)
	if err != nil {
		return fmt.Errorf("allocate workspace: %w", err)
	}
	defer func() { _ = deps.Pool.Cleanup(payload.TaskID) }()

	spec := RunSpec{
		Agent:           payload.Agent,
		Profile:         payload.Profile,
		Workspace:       ws,
		InitialMessages: msgs,
		Injection:       merged,
		Env:             merged.Env,
	}

	_ = stream.Progress(payload.TaskID, "running", "")
	res, err := deps.Runner.Run(ctx, spec)
	if err != nil {
		_ = stream.Result(payload.TaskID, "failed", "", "", err.Error())
		return err
	}
	_ = stream.Result(payload.TaskID, res.Status, res.Result, res.Model, res.Error)

	if deps.Recorder != nil && opts.LocalTaskID != "" && payload.MulticaTaskID != "" {
		if err := deps.Recorder.Record(ctx, opts.LocalTaskID, payload.MulticaTaskID); err != nil {
			return fmt.Errorf("record id mapping: %w", err)
		}
	}
	return nil
}

// NodeRunner spawns the embedded Node headless process running packages/core
// (决策一 A)。spec 写临时文件;core 读 spec、执行 REACT loop,stdout 输出
// JSONL {"type":"delta"|"result",...}。端到端验证属 S6 联调。
type NodeRunner struct {
	NodeBin   string   // 默认 "node"
	CoreEntry string   // 默认 env JARVIS_CORE_ENTRY
	ExtraEnv  []string
}

func (r *NodeRunner) Run(ctx context.Context, spec RunSpec) (RunResult, error) {
	dir, err := os.MkdirTemp("", "jarvis-agent-*")
	if err != nil {
		return RunResult{}, err
	}
	defer os.RemoveAll(dir)

	specPath := filepath.Join(dir, "spec.json")
	b, err := json.Marshal(spec)
	if err != nil {
		return RunResult{}, err
	}
	if err := os.WriteFile(specPath, b, 0o600); err != nil {
		return RunResult{}, err
	}

	cmd := exec.CommandContext(ctx, r.node(), r.coreEntry(), "--spec", specPath)
	cmd.Env = append(os.Environ(), r.ExtraEnv...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return RunResult{}, err
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return RunResult{}, err
	}

	var res RunResult
	sc := bufio.NewScanner(stdout)
	for sc.Scan() {
		var frame struct {
			Type   string `json:"type"`
			Status string `json:"status"`
			Result string `json:"result,omitempty"`
			Error  string `json:"error,omitempty"`
			Model  string `json:"model,omitempty"`
		}
		if err := json.Unmarshal(sc.Bytes(), &frame); err != nil {
			continue
		}
		if frame.Type == "result" {
			res = RunResult{Result: frame.Result, Model: frame.Model, Status: frame.Status, Error: frame.Error}
		}
	}
	if err := cmd.Wait(); err != nil {
		return RunResult{}, err
	}
	if res.Status == "" {
		res.Status = "failed"
		res.Error = "core produced no result frame"
	}
	return res, nil
}

func (r *NodeRunner) node() string {
	if r.NodeBin != "" {
		return r.NodeBin
	}
	return "node"
}

func (r *NodeRunner) coreEntry() string {
	if r.CoreEntry != "" {
		return r.CoreEntry
	}
	if v := os.Getenv("JARVIS_CORE_ENTRY"); v != "" {
		return v
	}
	return "packages/core/dist/headless.mjs"
}

func NewRunCmd(deps RunDeps, out io.Writer) *cobra.Command {
	var payloadFile string
	var localTaskID string
	cmd := &cobra.Command{
		Use:   "run",
		Short: "Execute one ACP task (JSON payload) via the core REACT loop",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			var data []byte
			var err error
			if payloadFile != "" {
				data, err = os.ReadFile(payloadFile)
			} else {
				data, err = io.ReadAll(cmd.InOrStdin())
			}
			if err != nil {
				return err
			}
			payload, err := acp.ParseTaskPayload(data)
			if err != nil {
				return err
			}
			return ExecuteTask(cmd.Context(), deps, payload, TaskOpts{LocalTaskID: localTaskID}, runtime.NewStreamWriter(out))
		},
	}
	cmd.Flags().StringVar(&payloadFile, "task", "", "path to task payload JSON (default: stdin)")
	cmd.Flags().StringVar(&localTaskID, "local-task-id", "", "local task id to record the multica mapping (L36)")
	return cmd
}
```

`daemon/cmd/jarvis-agent/sqlite.go` 追加(L36/H1.5/H1.14 真实实现):
```go
type sqliteHistoryLoader struct{ d *sql.DB }

func (s *sqliteHistoryLoader) Load(ctx context.Context, conversationID string) ([]acp.InitialMessage, error) {
	rows, err := s.d.QueryContext(ctx,
		`SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at`, conversationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []acp.InitialMessage
	for rows.Next() {
		var m acp.InitialMessage
		if err := rows.Scan(&m.Role, &m.Content); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

type sqliteTaskRecorder struct{ d *sql.DB }

func (s *sqliteTaskRecorder) Record(ctx context.Context, local, multica string) error {
	return db.MapTaskIDs(ctx, s.d, local, multica)
}

type sqliteProfileStore struct{ d *sql.DB }

func (s *sqliteProfileStore) Get(ctx context.Context, id string) (*db.Profile, error) {
	return db.GetProfile(ctx, s.d, id)
}
```
(sqlite.go 顶部 import 追加 `"context"`、`"database/sql"`、`"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/acp"`。)

`daemon/cmd/jarvis-agent/main.go`(修改,追加 run 命令):
```go
func main() {
	out := os.Stdout
	root := NewRootCmd(out)
	root.Version = cliVersion
	root.AddCommand(NewVersionCmd(staticVersion(cliVersion), out))
	root.AddCommand(NewHealthCmd(&defaultHealth{cliVersion: cliVersion}, out))

	if d, err := db.Open(defaultDBPath()); err != nil {
		log.Printf("warn: open db %s: %v", defaultDBPath(), err)
	} else {
		defer d.Close()
		root.AddCommand(NewListModelsCmd(sqliteModelLister{d: d}, out))
		root.AddCommand(NewRunCmd(RunDeps{
			Runner:   &NodeRunner{},
			History:  &sqliteHistoryLoader{d: d},
			Recorder: &sqliteTaskRecorder{d: d},
			Pool:     runtime.NewWorkspacePool(workspaceRoot()),
			Profiles: &sqliteProfileStore{d: d},
		}, out))
	}

	if err := root.Execute(); err != nil {
		os.Exit(1)
	}
}

func workspaceRoot() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(".", ".jarvis", "workspaces")
	}
	return filepath.Join(home, ".jarvis", "workspaces")
}
```
(main.go 顶部 import 追加 `"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"`。)

- [ ] **Step 5: 运行测试确认通过**

Run: `cd daemon && go test ./cmd/jarvis-agent/ ./internal/db/ && cd apps/desktop && pnpm vitest run src/main/db/migrations.spec.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add daemon/cmd/jarvis-agent/run.go daemon/cmd/jarvis-agent/run_test.go daemon/cmd/jarvis-agent/sqlite.go daemon/cmd/jarvis-agent/cli.go daemon/cmd/jarvis-agent/main.go daemon/internal/db/db.go apps/desktop/src/main/db/migrations.ts apps/desktop/src/main/db/migrations.spec.ts
git commit -m "feat(multica): jarvis-agent run execution flow with L36 id mapping and migration v5 (H1.3/H1.5/H1.8/H1.14)"
```

---

### Task 7: Multica Client 注册/心跳/轮询 + HTTP 传输(H1.10)

**Files:**
- Create: `daemon/internal/multica/client/client.go`
- Create: `daemon/internal/multica/client/client_test.go`
- Create: `daemon/internal/multica/client/httpapi.go`
- Create: `daemon/internal/multica/client/httpapi_test.go`

**Interfaces:**
- Consumes: Task 5 `runtime.StreamChunk`。
- Produces:
  - `ClientAPI { Register; Heartbeat; Poll; StreamProgress; SendResult; Ack }`(接口化以 httptest/fake 覆盖 Wire,§Wire 表)。
  - `RegisterRequest { ID; Name; Protocol "acp"; Version; Concurrency; Models []string }`、`RegisterResponse { ClientID; HeartbeatSec; PollSec }`。
  - `HeartbeatStatus { Status "idle"|"busy"; ActiveTasks; UpdatedAt }`、`ClaimedTask { TaskID; MulticaTaskID; Payload json.RawMessage }`、`TaskResult { Status; Result; Error; Model; FinishedAt }`。
  - `Client`:`NewClient(api, ClientOptions)`、`Register(ctx) (string, error)`、`RunOnce(ctx, hb) ([]ClaimedTask, error)`(确定性,测试用)、`Poll(ctx, hb)`、`Serve(ctx, statusFn) error`(15s 心跳 + 3s 轮询,可配置;H1.10)。
  - `HTTPClientAPI` — 按 §Wire 表实现 ClientAPI(标准库 HTTP)。

- [ ] **Step 1: 编写失败测试**

`daemon/internal/multica/client/client_test.go`:
```go
package client

import (
	"context"
	"testing"
	"time"
)

type fakeAPI struct {
	registered []RegisterRequest
	lastHB     HeartbeatStatus
	polls      int
	tasks      []ClaimedTask
}

func (f *fakeAPI) Register(_ context.Context, req RegisterRequest) (RegisterResponse, error) {
	f.registered = append(f.registered, req)
	return RegisterResponse{ClientID: "client-1", HeartbeatSec: 15, PollSec: 3}, nil
}

func (f *fakeAPI) Heartbeat(_ context.Context, _ string, hb HeartbeatStatus) error {
	f.lastHB = hb
	return nil
}

func (f *fakeAPI) Poll(_ context.Context, _ string) ([]ClaimedTask, error) {
	f.polls++
	return f.tasks, nil
}

func (f *fakeAPI) StreamProgress(_ context.Context, _, _ string, _ StreamChunk) error { return nil }
func (f *fakeAPI) SendResult(_ context.Context, _, _ string, _ TaskResult) error     { return nil }
func (f *fakeAPI) Ack(_ context.Context, _, _ string, _ bool) error                 { return nil }

func TestRegister(t *testing.T) {
	f := &fakeAPI{}
	c := NewClient(f, ClientOptions{Name: "mac-mini", Version: "0.1.0", Concurrency: 6, Models: []string{"m1"}})
	id, err := c.Register(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if id != "client-1" {
		t.Fatalf("got %s", id)
	}
	if len(f.registered) != 1 || f.registered[0].Protocol != "acp" || f.registered[0].Models[0] != "m1" {
		t.Fatalf("unexpected register req: %+v", f.registered)
	}
}

func TestRunOnceHeartbeatAndPoll(t *testing.T) {
	f := &fakeAPI{tasks: []ClaimedTask{{TaskID: "t1", MulticaTaskID: "mt1", Payload: []byte(`{"taskId":"t1","instruction":"x"}`)}}}
	c := NewClient(f, ClientOptions{})
	tasks, err := c.RunOnce(context.Background(), HeartbeatStatus{Status: "idle", ActiveTasks: 0})
	if err != nil {
		t.Fatal(err)
	}
	if f.lastHB.Status != "idle" {
		t.Fatalf("heartbeat not sent: %+v", f.lastHB)
	}
	if len(tasks) != 1 || tasks[0].MulticaTaskID != "mt1" {
		t.Fatalf("unexpected tasks: %+v", tasks)
	}
}

func TestPollBeforeRegisterFails(t *testing.T) {
	f := &fakeAPI{}
	c := NewClient(f, ClientOptions{})
	if _, err := c.Poll(context.Background(), HeartbeatStatus{Status: "idle"}); err == nil {
		t.Fatal("expected error when not registered")
	}
}
```
(client_test.go 需 import `"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"` 别名 StreamChunk,或直接 `runtime.StreamChunk`;test 中签名使用 `runtime.StreamChunk`。将 StreamChunk 引用写为 `runtime.StreamChunk`,顶部 import `"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"` 与 `_ = time` 按需。)

`daemon/internal/multica/client/httpapi_test.go`:
```go
package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"
)

func decodeJSON(r *http.Request, v any) { _ = json.NewDecoder(r.Body).Decode(v) }
func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func TestHTTPClientAPIRoundTrip(t *testing.T) {
	var gotReg RegisterRequest
	var gotHB HeartbeatStatus
	var sentResult TaskResult
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/clients/register":
			decodeJSON(r, &gotReg)
			writeJSON(w, RegisterResponse{ClientID: "c1", HeartbeatSec: 15, PollSec: 3})
		case r.Method == http.MethodPost && r.URL.Path == "/clients/c1/heartbeat":
			decodeJSON(r, &gotHB)
			w.WriteHeader(http.StatusOK)
		case r.Method == http.MethodGet && r.URL.Path == "/clients/c1/tasks":
			writeJSON(w, []ClaimedTask{{TaskID: "t1", MulticaTaskID: "mt1", Payload: []byte(`{"taskId":"t1","instruction":"x"}`)}})
		case r.Method == http.MethodPost && r.URL.Path == "/clients/c1/tasks/t1/result":
			decodeJSON(r, &sentResult)
			w.WriteHeader(http.StatusOK)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	api := &HTTPClientAPI{BaseURL: srv.URL, HTTP: &http.Client{Timeout: 2 * time.Second}}
	c := NewClient(api, ClientOptions{Name: "mac", Version: "0.1.0", Concurrency: 6})
	tasks, err := c.RunOnce(context.Background(), HeartbeatStatus{Status: "idle"})
	if err != nil {
		t.Fatal(err)
	}
	if gotReg.Protocol != "acp" || len(tasks) != 1 {
		t.Fatalf("reg=%+v tasks=%+v", gotReg, tasks)
	}
	if err := api.SendResult(context.Background(), "c1", "t1", TaskResult{Status: "completed", Result: "ok"}); err != nil {
		t.Fatal(err)
	}
	if sentResult.Status != "completed" {
		t.Fatalf("unexpected result: %+v", sentResult)
	}
}

func TestHTTPClientAPIStreamProgressFrame(t *testing.T) {
	var got runtime.StreamChunk
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		decodeJSON(r, &got)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	api := &HTTPClientAPI{BaseURL: srv.URL, HTTP: &http.Client{Timeout: 2 * time.Second}}
	if err := api.StreamProgress(context.Background(), "c1", "t1", runtime.StreamChunk{Type: "progress", TaskID: "t1", Status: "running", Delta: "hi"}); err != nil {
		t.Fatal(err)
	}
	if got.Type != "progress" || got.Delta != "hi" {
		t.Fatalf("unexpected chunk: %+v", got)
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd daemon && go test ./internal/multica/client/`
Expected: FAIL(client.go/httpapi.go 不存在)。

- [ ] **Step 3: 编写实现**

`daemon/internal/multica/client/client.go`:
```go
package client

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"
)

// ClientAPI abstracts the Multica Server wire calls (§Wire) for testability.
type ClientAPI interface {
	Register(ctx context.Context, req RegisterRequest) (RegisterResponse, error)
	Heartbeat(ctx context.Context, clientID string, status HeartbeatStatus) error
	Poll(ctx context.Context, clientID string) ([]ClaimedTask, error)
	StreamProgress(ctx context.Context, clientID, taskID string, chunk runtime.StreamChunk) error
	SendResult(ctx context.Context, clientID, taskID string, res TaskResult) error
	Ack(ctx context.Context, clientID, taskID string, ok bool) error
}

type RegisterRequest struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Protocol    string   `json:"protocol"` // "acp"
	Version     string   `json:"version"`
	Concurrency int      `json:"concurrency"`
	Models      []string `json:"models,omitempty"` // H1.9
}

type RegisterResponse struct {
	ClientID     string `json:"clientId"`
	HeartbeatSec int    `json:"heartbeatInterval"`
	PollSec      int    `json:"pollInterval"`
}

type HeartbeatStatus struct {
	Status      string `json:"status"` // "idle" | "busy"
	ActiveTasks int    `json:"activeTasks"`
	UpdatedAt   int64  `json:"updatedAt"`
}

type ClaimedTask struct {
	TaskID        string          `json:"taskId"`
	MulticaTaskID string          `json:"multicaTaskId"`
	Payload       json.RawMessage `json:"payload"`
}

type TaskResult struct {
	Status     string `json:"status"` // completed | failed
	Result     string `json:"result,omitempty"`
	Error      string `json:"error,omitempty"`
	Model      string `json:"model,omitempty"`
	FinishedAt int64  `json:"finishedAt"`
}

// Client drives the ACP registration/heartbeat/poll cycle (H1.10).
type Client struct {
	api          ClientAPI
	heartbeatSec time.Duration
	pollSec      time.Duration
	name         string
	version      string
	concurrency  int
	models       []string
	registration RegisterResponse
}

type ClientOptions struct {
	Name         string
	Version      string
	Concurrency  int
	Models       []string
	HeartbeatSec time.Duration
	PollSec      time.Duration
}

func NewClient(api ClientAPI, opts ClientOptions) *Client {
	if opts.HeartbeatSec == 0 {
		opts.HeartbeatSec = 15 * time.Second
	}
	if opts.PollSec == 0 {
		opts.PollSec = 3 * time.Second
	}
	return &Client{
		api: api, heartbeatSec: opts.HeartbeatSec, pollSec: opts.PollSec,
		name: opts.Name, version: opts.Version, concurrency: opts.Concurrency, models: opts.Models,
	}
}

// Register performs H1.10 registration/discovery; returns the client id.
func (c *Client) Register(ctx context.Context) (string, error) {
	req := RegisterRequest{
		ID: c.name, Name: c.name, Protocol: "acp", Version: c.version,
		Concurrency: c.concurrency, Models: c.models,
	}
	res, err := c.api.Register(ctx, req)
	if err != nil {
		return "", fmt.Errorf("multica register: %w", err)
	}
	c.registration = res
	return res.ClientID, nil
}

// Poll sends a heartbeat then fetches pending tasks (deterministic step).
func (c *Client) Poll(ctx context.Context, hb HeartbeatStatus) ([]ClaimedTask, error) {
	if c.registration.ClientID == "" {
		return nil, fmt.Errorf("not registered")
	}
	if err := c.api.Heartbeat(ctx, c.registration.ClientID, hb); err != nil {
		return nil, err
	}
	return c.api.Poll(ctx, c.registration.ClientID)
}

// RunOnce performs one register + poll cycle (deterministic, for tests).
func (c *Client) RunOnce(ctx context.Context, hb HeartbeatStatus) ([]ClaimedTask, error) {
	if _, err := c.Register(ctx); err != nil {
		return nil, err
	}
	return c.Poll(ctx, hb)
}

// Serve runs register + 15s heartbeat + 3s poll until ctx is done (H1.10).
// 轮询到的任务交由 onTasks 处理(接单/执行在 Task 8)。
func (c *Client) Serve(ctx context.Context, status func() HeartbeatStatus, onTasks func([]ClaimedTask)) error {
	if _, err := c.Register(ctx); err != nil {
		return err
	}
	hb := time.NewTicker(c.heartbeatSec)
	poll := time.NewTicker(c.pollSec)
	defer hb.Stop()
	defer poll.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-hb.C:
			if err := c.api.Heartbeat(ctx, c.registration.ClientID, status()); err != nil {
				return err
			}
		case <-poll.C:
			tasks, err := c.api.Poll(ctx, c.registration.ClientID)
			if err != nil {
				return err
			}
			if onTasks != nil && len(tasks) > 0 {
				onTasks(tasks)
			}
		}
	}
}
```

`daemon/internal/multica/client/httpapi.go`:
```go
package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"
)

// HTTPClientAPI implements ClientAPI against a Multica Server HTTP endpoint (§Wire)。
type HTTPClientAPI struct {
	BaseURL string
	HTTP    *http.Client
}

func (h *HTTPClientAPI) Register(ctx context.Context, req RegisterRequest) (RegisterResponse, error) {
	var out RegisterResponse
	err := h.do(ctx, http.MethodPost, "/clients/register", req, &out)
	return out, err
}

func (h *HTTPClientAPI) Heartbeat(ctx context.Context, id string, hb HeartbeatStatus) error {
	return h.do(ctx, http.MethodPost, "/clients/"+id+"/heartbeat", hb, nil)
}

func (h *HTTPClientAPI) Poll(ctx context.Context, id string) ([]ClaimedTask, error) {
	var out []ClaimedTask
	err := h.do(ctx, http.MethodGet, "/clients/"+id+"/tasks", nil, &out)
	return out, err
}

func (h *HTTPClientAPI) StreamProgress(ctx context.Context, id, taskID string, c runtime.StreamChunk) error {
	return h.do(ctx, http.MethodPost, "/clients/"+id+"/tasks/"+taskID+"/progress", c, nil)
}

func (h *HTTPClientAPI) SendResult(ctx context.Context, id, taskID string, r TaskResult) error {
	return h.do(ctx, http.MethodPost, "/clients/"+id+"/tasks/"+taskID+"/result", r, nil)
}

func (h *HTTPClientAPI) Ack(ctx context.Context, id, taskID string, ok bool) error {
	return h.do(ctx, http.MethodPost, "/clients/"+id+"/tasks/"+taskID+"/ack", map[string]bool{"accepted": ok}, nil)
}

func (h *HTTPClientAPI) do(ctx context.Context, method, path string, in, out any) error {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, h.BaseURL+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := h.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("multica %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("multica %s %s: status %d: %s", method, path, resp.StatusCode, truncate(string(b), 200))
	}
	if out != nil {
		return json.NewDecoder(resp.Body).Decode(out)
	}
	return nil
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd daemon && go test ./internal/multica/client/`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add daemon/internal/multica/client/client.go daemon/internal/multica/client/client_test.go daemon/internal/multica/client/httpapi.go daemon/internal/multica/client/httpapi_test.go
git commit -m "feat(multica): client registration/heartbeat/poll with HTTP transport (H1.10)"
```

---

### Task 8: 接单→执行→流式回传闭环 + daemon 组装(H1.10/H1.11/H1.13/H1.7)

**Files:**
- Create: `daemon/internal/multica/client/handler.go`
- Create: `daemon/internal/multica/client/handler_test.go`
- Create: `daemon/internal/multica/client/inject.go`
- Create: `daemon/internal/multica/client/conflict.go`
- Create: `daemon/internal/multica/client/conflict_test.go`
- Create: `daemon/internal/multica/client/invoker.go`
- Modify: `daemon/cmd/jarvis-daemon/main.go`

**Interfaces:**
- Consumes: Task 3 `acp`、Task 4 `MergeInjections`、Task 5 `runtime.Queue/WorkspacePool/StreamChunk`、Task 7 `ClientAPI/ClaimedTask/TaskResult`。
- Produces:
  - `ConflictItem { TaskID; Skill *acp.SkillConflict; MCP *acp.MCPConflict; Resolved bool }`、`ConflictStore{ Add; Conflicts; Resolve(name, decision) bool }`(L38 数据)。
  - `SkillFS { ReadDir; Copy; MkdirAll }`、`applyInjection(ctx, p, local, workspace, fs) (*acp.TaskPayload, []acp.SkillConflict, []acp.MCPConflict, error)` — 合并 + H1.7 skill 落盘到 `workspace/.jarvis/skills/`,返回 merged payload 供 jarvis-agent run。
  - `AgentInvoker { RunTask(ctx, payload *acp.TaskPayload, onChunk func(runtime.StreamChunk)) (TaskResult, error) }`;`subprocessAgentInvoker`(真实:临时 payload 文件 + spawn `jarvis-agent run`,JSONL stdout→onChunk;端到端属 S6)。
  - `ExecFunc func(ctx, payload, onChunk) (TaskResult, error)`。
  - `ClaimHandler { API; Queue; ClientID func() string; Exec ExecFunc; Recorder TaskRecorder; Conflicts *ConflictStore }`:`HandleClaims(ctx, tasks) error` — 解析→ack→submit(queued→running→completed/failed,H1.13/H1.11)→流式回传(H1.4)→冲突记录(L38)→ID 映射(L36)。
  - `daemon/cmd/jarvis-daemon/main.go`:组装 `runtimeState` + `ConflictStore` + `HTTPClientAPI` + `Client.Serve`(15s/3s)+ ClaimHandler + Queue(6/20)+ WorkspacePool + httpapi。

- [ ] **Step 1: 编写失败测试**

`daemon/internal/multica/client/conflict_test.go`:
```go
package client

import (
	"testing"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/acp"
)

func TestConflictStoreAddAndResolve(t *testing.T) {
	cs := NewConflictStore()
	cs.Add(ConflictItem{TaskID: "t1", Skill: &acp.SkillConflict{Name: "review", LocalPath: "/l", MulticaPath: "/m"}})
	if len(cs.Conflicts()) != 1 {
		t.Fatalf("want 1 conflict, got %d", len(cs.Conflicts()))
	}
	if !cs.Resolve("review", "local") {
		t.Fatal("expected resolve true")
	}
	if cs.Resolve("review", "local") {
		t.Fatal("expected second resolve false")
	}
	if !cs.Conflicts()[0].Resolved {
		t.Fatalf("conflict not marked resolved: %+v", cs.Conflicts()[0])
	}
}
```

`daemon/internal/multica/client/handler_test.go`:
```go
package client

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/acp"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"
)

type recordingAPI struct {
	mu       sync.Mutex
	acks     []bool
	streams  []runtime.StreamChunk
	results  []TaskResult
	tasks    []ClaimedTask
}

func (f *recordingAPI) Register(context.Context, RegisterRequest) (RegisterResponse, error) {
	return RegisterResponse{ClientID: "c1", HeartbeatSec: 15, PollSec: 3}, nil
}
func (f *recordingAPI) Heartbeat(context.Context, string, HeartbeatStatus) error { return nil }
func (f *recordingAPI) Poll(context.Context, string) ([]ClaimedTask, error)      { return f.tasks, nil }
func (f *recordingAPI) StreamProgress(_ context.Context, _ string, _ string, c runtime.StreamChunk) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.streams = append(f.streams, c)
	return nil
}
func (f *recordingAPI) SendResult(_ context.Context, _, _ string, r TaskResult) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.results = append(f.results, r)
	return nil
}
func (f *recordingAPI) Ack(_ context.Context, _, _ string, ok bool) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.acks = append(f.acks, ok)
	return nil
}

func (f *recordingAPI) resultCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.results)
}

func TestHandleClaimsRunsAndStreams(t *testing.T) {
	f := &recordingAPI{tasks: []ClaimedTask{{TaskID: "t1", MulticaTaskID: "mt1", Payload: []byte(`{"taskId":"t1","multicaTaskId":"mt1","instruction":"fix it"}`)}}}
	q := runtime.NewQueue(1, 2)
	h := &ClaimHandler{
		API:      f,
		Queue:    q,
		ClientID: func() string { return "c1" },
		Exec: func(_ context.Context, _ *acp.TaskPayload, _ func(runtime.StreamChunk)) (TaskResult, error) {
			return TaskResult{Status: "completed", Result: "done", Model: "m1", FinishedAt: time.Now().Unix()}, nil
		},
		Recorder: &fakeRecorder{},
	}
	if err := h.HandleClaims(context.Background(), f.tasks); err != nil {
		t.Fatal(err)
	}
	deadline := time.After(2 * time.Second)
	for f.resultCount() < 1 {
		select {
		case <-deadline:
			t.Fatal("no result sent")
		case <-time.After(10 * time.Millisecond):
		}
	}
	if len(f.streams) == 0 {
		t.Fatal("no progress streamed")
	}
	if len(f.acks) != 1 || !f.acks[0] {
		t.Fatalf("expected ack true: %v", f.acks)
	}
}

func TestHandleClaimsRejectsBadPayload(t *testing.T) {
	f := &recordingAPI{tasks: []ClaimedTask{{TaskID: "bad", MulticaTaskID: "mb", Payload: []byte(`{"multicaTaskId":"mb"}`)}}}
	q := runtime.NewQueue(1, 2)
	h := &ClaimHandler{
		API:      f,
		Queue:    q,
		ClientID: func() string { return "c1" },
		Exec: func(context.Context, *acp.TaskPayload, func(runtime.StreamChunk)) (TaskResult, error) {
			t.Fatal("exec should not run for bad payload")
			return TaskResult{}, nil
		},
		Recorder: &fakeRecorder{},
	}
	if err := h.HandleClaims(context.Background(), f.tasks); err != nil {
		t.Fatal(err)
	}
	if len(f.acks) != 1 || f.acks[0] {
		t.Fatalf("expected ack false: %v", f.acks)
	}
}
```
(handler_test.go 的 fakeRecorder 复用 run_test.go 同名类型,但二者分属不同包——`cmd/jarvis-agent` 是 package main,`internal/multica/client` 是 package client。因此 handler_test.go 需要本地定义 fakeRecorder。在 handler_test.go 内定义:`type fakeRecorder struct{ calls [][2]string }` + `func (f *fakeRecorder) Record(context.Context, string, string) error { return nil }`。)

`daemon/internal/multica/client/inject.go` 测试(并入 handler_test.go 或独立;本计划并入 handler_test.go 顶部定义 fakeSkillFS 并断言 applyInjection):
```go
type fakeSkillFS struct {
	dirs   map[string]bool
	copies [][2]string
}

func (f *fakeSkillFS) ReadDir(string) ([]string, error) { return nil, nil }
func (f *fakeSkillFS) Copy(src, dst string) error       { f.copies = append(f.copies, [2]string{src, dst}); return nil }
func (f *fakeSkillFS) MkdirAll(d string) error          { f.dirs[d] = true; return nil }

func TestApplyInjectionCopiesSkills(t *testing.T) {
	fs := &fakeSkillFS{dirs: map[string]bool{}}
	p := &acp.TaskPayload{TaskID: "t1", Instruction: "x", Skills: []string{"s1"}}
	merged, sc, mc, err := applyInjection(context.Background(), p, acp.Injection{}, "/ws/t1", fs)
	if err != nil {
		t.Fatal(err)
	}
	if len(sc) != 0 || len(mc) != 0 {
		t.Fatalf("no conflicts expected: %v %v", sc, mc)
	}
	if len(fs.copies) != 1 || fs.copies[0][1] != "/ws/t1/.jarvis/skills/s1" {
		t.Fatalf("skill not copied: %v", fs.copies)
	}
	if merged.Skills == nil {
		t.Fatalf("merged payload missing skills: %+v", merged)
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd daemon && go test ./internal/multica/client/`
Expected: FAIL(handler.go/inject.go/conflict.go 不存在)。

- [ ] **Step 3: 编写实现**

`daemon/internal/multica/client/conflict.go`:
```go
package client

import (
	"sync"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/acp"
)

// ConflictItem is one L38 injection conflict surfaced to the UI.
type ConflictItem struct {
	TaskID   string             `json:"taskId"`
	Skill    *acp.SkillConflict `json:"skill,omitempty"`
	MCP      *acp.MCPConflict   `json:"mcp,omitempty"`
	Resolved bool               `json:"resolved"`
}

// ConflictStore keeps the most recent injection conflicts for the UI (L38).
type ConflictStore struct {
	mu    sync.Mutex
	items []ConflictItem
}

func NewConflictStore() *ConflictStore { return &ConflictStore{} }

func (c *ConflictStore) Add(items ...ConflictItem) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.items = append(c.items, items...)
}

func (c *ConflictStore) Conflicts() []ConflictItem {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]ConflictItem{}, c.items...)
}

// Resolve marks the first unresolved conflict with name as resolved.
func (c *ConflictStore) Resolve(name, _ string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	for i := range c.items {
		key := ""
		if c.items[i].Skill != nil {
			key = c.items[i].Skill.Name
		}
		if c.items[i].MCP != nil {
			key = c.items[i].MCP.Name
		}
		if key == name && !c.items[i].Resolved {
			c.items[i].Resolved = true
			return true
		}
	}
	return false
}
```

`daemon/internal/multica/client/inject.go`:
```go
package client

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/acp"
)

// SkillFS abstracts skill copy filesystem ops (H1.7).
type SkillFS interface {
	ReadDir(dir string) ([]string, error)
	Copy(src, dst string) error
	MkdirAll(dir string) error
}

// applyInjection merges local + Multica injections (H1.6-H1.8), copies Multica
// skills into the task workspace .jarvis/skills/ (H1.7), and returns the merged
// TaskPayload handed to `jarvis-agent run`, plus L38 conflicts.
func applyInjection(ctx context.Context, p *acp.TaskPayload, local acp.Injection, workspace string, fs SkillFS) (*acp.TaskPayload, []acp.SkillConflict, []acp.MCPConflict, error) {
	remote := acp.Injection{MCPServers: p.MCPServers, Env: p.Env, CLIArgs: p.CLIArgs}
	merged, sc, mc := acp.MergeInjections(local, remote)

	out := *p
	out.MCPServers = merged.MCPServers
	out.Env = merged.Env
	out.CLIArgs = merged.CLIArgs

	if len(p.Skills) > 0 {
		dst := filepath.Join(workspace, ".jarvis", "skills")
		if err := fs.MkdirAll(dst); err != nil {
			return nil, nil, nil, fmt.Errorf("mkdir skills: %w", err)
		}
		var specs []acp.SkillSpec
		for _, name := range p.Skills {
			src := filepath.Join(workspace, name)
			target := filepath.Join(dst, name)
			if err := fs.Copy(src, target); err != nil {
				return nil, nil, nil, fmt.Errorf("copy skill %s: %w", name, err)
			}
			specs = append(specs, acp.SkillSpec{Source: "multica", Name: name, Path: target})
		}
		out.Skills = nil // Skill 内容已落盘 .jarvis/skills/,由 M3 SkillsLoader 扫描
	}
	return &out, sc, mc, nil
}
```

`daemon/internal/multica/client/handler.go`:
```go
package client

import (
	"context"
	"time"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/acp"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"
)

// ExecFunc runs one parsed task; onChunk forwards stream frames (H1.4).
type ExecFunc func(ctx context.Context, payload *acp.TaskPayload, onChunk func(runtime.StreamChunk)) (TaskResult, error)

// TaskRecorder persists the local<->multica id mapping (L36).
type TaskRecorder interface {
	Record(ctx context.Context, localTaskID, multicaTaskID string) error
}

// ClaimHandler turns claimed tasks into queued local jobs and streams results back
// (H1.10/H1.11/H1.13/H1.4/L36/L38)。
type ClaimHandler struct {
	API      ClientAPI
	Queue    *runtime.Queue
	ClientID func() string
	Exec     ExecFunc
	Recorder TaskRecorder
	Conflicts *ConflictStore
}

// HandleClaims parses each claimed task, acks, and submits to the Queue with
// lifecycle queued→running→completed/failed (H1.13) and concurrency (H1.11).
func (h *ClaimHandler) HandleClaims(ctx context.Context, tasks []ClaimedTask) error {
	for _, tk := range tasks {
		payload, err := acp.ParseTaskPayload(tk.Payload)
		if err != nil {
			_ = h.API.Ack(ctx, h.ClientID(), tk.TaskID, false)
			continue
		}
		_ = h.API.Ack(ctx, h.ClientID(), tk.TaskID, true)
		localID := tk.TaskID
		h.Queue.Submit(runtime.Job{ID: localID, Run: func() {
			_ = h.runOne(ctx, payload, localID, tk.MulticaTaskID)
		}})
	}
	return nil
}

func (h *ClaimHandler) runOne(ctx context.Context, payload *acp.TaskPayload, localID, multicaID string) error {
	onChunk := func(ch runtime.StreamChunk) {
		_ = h.API.StreamProgress(ctx, h.ClientID(), payload.TaskID, ch)
	}
	onChunk(runtime.StreamChunk{Type: "progress", TaskID: payload.TaskID, Status: "running", TS: time.Now().Unix()})

	res, err := h.Exec(ctx, payload, onChunk)
	if err != nil {
		res = TaskResult{Status: "failed", Error: err.Error(), FinishedAt: time.Now().Unix()}
	}
	if err := h.API.SendResult(ctx, h.ClientID(), payload.TaskID, res); err != nil {
		return err
	}
	if h.Recorder != nil {
		_ = h.Recorder.Record(ctx, localID, multicaID)
	}
	return nil
}
```

`daemon/internal/multica/client/invoker.go`:
```go
package client

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/acp"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"
)

// AgentInvoker runs a task via `jarvis-agent run` (决策一 A)。
type AgentInvoker interface {
	RunTask(ctx context.Context, payload *acp.TaskPayload, onChunk func(runtime.StreamChunk)) (TaskResult, error)
}

// subprocessAgentInvoker spawns jarvis-agent as a subprocess and forwards its
// JSONL stdout frames (H1.4)。端到端验证属 S6 联调;单测用 fake。
type subprocessAgentInvoker struct {
	Bin string // 默认 "jarvis-agent"(PATH 探测,H1.1)
}

func (s *subprocessAgentInvoker) RunTask(ctx context.Context, p *acp.TaskPayload, onChunk func(runtime.StreamChunk)) (TaskResult, error) {
	dir, err := os.MkdirTemp("", "jarvis-claim-*")
	if err != nil {
		return TaskResult{}, err
	}
	defer os.RemoveAll(dir)

	payloadPath := filepath.Join(dir, "payload.json")
	b, err := json.Marshal(p)
	if err != nil {
		return TaskResult{}, err
	}
	if err := os.WriteFile(payloadPath, b, 0o600); err != nil {
		return TaskResult{}, err
	}

	bin := s.Bin
	if bin == "" {
		bin = "jarvis-agent"
	}
	cmd := exec.CommandContext(ctx, bin, "run", "--task", payloadPath, "--local-task-id", p.TaskID)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return TaskResult{}, err
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return TaskResult{}, err
	}

	var res TaskResult
	sc := bufio.NewScanner(stdout)
	for sc.Scan() {
		var frame runtime.StreamChunk
		if err := json.Unmarshal(sc.Bytes(), &frame); err != nil {
			continue
		}
		if onChunk != nil && frame.Type == "progress" {
			onChunk(frame)
		}
		if frame.Type == "result" {
			res = TaskResult{Status: frame.Status, Result: frame.Result, Error: frame.Error, Model: frame.Model, FinishedAt: frame.TS}
		}
	}
	if err := cmd.Wait(); err != nil {
		return TaskResult{}, err
	}
	if res.Status == "" {
		res = TaskResult{Status: "failed", Error: "agent produced no result frame"}
	}
	return res, nil
}
```

`daemon/cmd/jarvis-daemon/main.go`(修改,组装 Multica Client;参考 M3 的 getenv/getenvInt):
```go
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/db"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/httpapi"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/acp"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/client"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"
)

func main() {
	port := getenv("JARVIS_DAEMON_PORT", "17890")
	perAgent := getenvInt("JARVIS_CONCURRENCY_PER_AGENT", 6)
	machine := getenvInt("JARVIS_CONCURRENCY_MACHINE", 20)
	multicaURL := getenv("JARVIS_MULTICA_SERVER", "")

	q := runtime.NewQueue(perAgent, machine)
	pool := runtime.NewWorkspacePool(getenv("JARVIS_WORKSPACES", defaultWorkspaces()))
	st := &runtimeState{serverURL: multicaURL}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	if multicaURL != "" {
		api := &client.HTTPClientAPI{BaseURL: multicaURL, HTTP: &http.Client{Timeout: 10 * time.Second}}
		cs := client.NewConflictStore()
		handler := &client.ClaimHandler{
			API:       api,
			Queue:     q,
			ClientID:  func() string { return "jarvis" },
			Exec:      agentExec(&client.SubprocessAgentInvoker{}, st),
			Recorder:  &sqliteRecorder{},
			Conflicts: cs,
		}
		cl := client.NewClient(api, client.ClientOptions{Name: "jarvis", Version: "0.1.0", Concurrency: perAgent})
		go func() {
			if err := cl.Serve(ctx, func() client.HeartbeatStatus {
				st.mu.Lock()
				defer st.mu.Unlock()
				st.registered = true
				return client.HeartbeatStatus{Status: heartbeatStatus(q), ActiveTasks: q.Active()}
			}, func(tasks []client.ClaimedTask) { _ = handler.HandleClaims(ctx, tasks) }); err != nil {
				log.Printf("multica client stopped: %v", err)
			}
		}()
	}

	srv := httpapi.NewServer("0.1.1", q, st, cs)
	log.Printf("jarvis-daemon on 127.0.0.1:%s concurrency %d/%d", port, perAgent, machine)
	if err := http.ListenAndServe("127.0.0.1:"+port, srv.Handler()); err != nil {
		log.Fatal(err)
	}
}

// runtimeState implements httpapi.RuntimeInfo (L39 数据面)。
type runtimeState struct {
	mu         sync.Mutex
	registered bool
	busy       bool
	active     int
	heartbeat  int64
	serverURL  string
}

func (s *runtimeState) Registered() bool     { s.mu.Lock(); defer s.mu.Unlock(); return s.registered }
func (s *runtimeState) Busy() bool           { s.mu.Lock(); defer s.mu.Unlock(); return s.busy }
func (s *runtimeState) ActiveTasks() int     { s.mu.Lock(); defer s.mu.Unlock(); return q.Active() }
func (s *runtimeState) LastHeartbeatAt() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.heartbeat
}
func (s *runtimeState) ServerURL() string   { s.mu.Lock(); defer s.mu.Unlock(); return s.serverURL }
func (s *runtimeState) CLIProtocol() string { return "acp" }

func heartbeatStatus(q *runtime.Queue) string {
	if q.Active() > 0 {
		return "busy"
	}
	return "idle"
}

// agentExec 把任务交给 jarvis-agent 子进程执行并转发流帧(S6 端到端)。
func agentExec(invoker client.AgentInvoker, st *runtimeState) client.ExecFunc {
	return func(ctx context.Context, p *acp.TaskPayload, onChunk func(runtime.StreamChunk)) (client.TaskResult, error) {
		st.mu.Lock()
		st.busy = true
		st.heartbeat = time.Now().Unix()
		st.mu.Unlock()
		defer func() {
			st.mu.Lock()
			st.busy = false
			st.mu.Unlock()
		}()
		res, err := invoker.RunTask(ctx, p, onChunk)
		return res, err
	}
}

func defaultWorkspaces() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(".", ".jarvis", "workspaces")
	}
	return filepath.Join(home, ".jarvis", "workspaces")
}

type sqliteRecorder struct{}

func (s *sqliteRecorder) Record(ctx context.Context, local, multica string) error {
	d, err := db.Open(defaultDBPath())
	if err != nil {
		return err
	}
	defer d.Close()
	return db.MapTaskIDs(ctx, d, local, multica)
}
```
(main.go 需 import `"path/filepath"`;`q.Active()` 为 M3 Queue 需暴露的方法——若 M3 未提供,用 `q.Status().ActiveTasks`(M3 `Status() {running, queued, activeTasks}`),将 `q.Active()` 改为 `q.Status().ActiveTasks`。)

- [ ] **Step 4: 运行测试确认通过**

Run: `cd daemon && go test ./...`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add daemon/internal/multica/client/handler.go daemon/internal/multica/client/handler_test.go daemon/internal/multica/client/inject.go daemon/internal/multica/client/conflict.go daemon/internal/multica/client/conflict_test.go daemon/internal/multica/client/invoker.go daemon/cmd/jarvis-daemon/main.go
git commit -m "feat(multica): claim-to-run-to-stream loop and daemon wiring (H1.10/H1.11/H1.13/H1.7)"
```

---

### Task 9: Runtime 状态 API + main IPC + store(L39 数据面)

**Files:**
- Modify: `daemon/internal/httpapi/server.go`(NewServer variadic + /runtime/status + /runtime/conflicts)
- Create: `daemon/internal/httpapi/runtime_status_test.go`
- Modify: `apps/desktop/src/main/daemon/DaemonSupervisor.ts`(轮询 runtime 状态/冲突缓存)
- Create: `apps/desktop/src/main/ipc/runtime.ts`
- Modify: `apps/desktop/src/main/ipc/IpcRouter.ts`
- Create: `apps/desktop/src/renderer/src/stores/runtime-store.ts`
- Create: `apps/desktop/src/renderer/src/stores/runtime-store.spec.ts`

**Interfaces:**
- Consumes: Task 7 `HTTPClientAPI`、Task 8 `ConflictStore/ConflictItem`、M3 `runtime.Queue.Status()`。
- Produces:
  - `httpapi.RuntimeInfo { Registered(); Busy(); ActiveTasks(); LastHeartbeatAt(); ServerURL(); CLIProtocol() }`、`httpapi.ConflictSource { Conflicts() []client.ConflictItem }`。
  - `httpapi.NewServer(version string, q *runtime.Queue, extra ...ServerExtra)` — 向后兼容(variadic);新增 `/runtime/status`(L39 数据)与 `/runtime/conflicts`(L38 数据)。
  - `DaemonSupervisor` 轮询缓存 `RuntimeStatusData { registered; busy; activeTasks; lastHeartbeatAt; serverUrl; protocol; mode }` 与 `ConflictItem[]`。
  - IPC:`runtime.status`、`runtime.conflicts`、`runtime.resolveConflict {name, decision}`(决策写 settings `multica.conflicts`,main 属主)。
  - `stores/runtime-store.ts`:`RuntimeStatus`、`deriveMode(registered, busy): 'local'|'runtime_registered'|'runtime_busy'`(L39)、zustand store `useRuntimeStore{ status; refresh }`。

- [ ] **Step 1: 编写失败测试(Go 端点)**

`daemon/internal/httpapi/runtime_status_test.go`:
```go
package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/acp"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/client"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"
)

type fakeRuntime struct {
	registered bool
	busy       bool
	active     int
	heartbeat  int64
	serverURL  string
}

func (f fakeRuntime) Registered() bool     { return f.registered }
func (f fakeRuntime) Busy() bool           { return f.busy }
func (f fakeRuntime) ActiveTasks() int     { return f.active }
func (f fakeRuntime) LastHeartbeatAt() int64 { return f.heartbeat }
func (f fakeRuntime) ServerURL() string    { return f.serverURL }
func (f fakeRuntime) CLIProtocol() string  { return "acp" }

func TestRuntimeStatusEndpoint(t *testing.T) {
	q := runtime.NewQueue(6, 20)
	srv := NewServer("0.1.1", q, fakeRuntime{registered: true, busy: false, serverURL: "https://multica.example"})
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/runtime/status", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out["registered"] != true || out["serverUrl"] != "https://multica.example" {
		t.Fatalf("unexpected: %v", out)
	}
}

func TestRuntimeConflictsEndpoint(t *testing.T) {
	q := runtime.NewQueue(6, 20)
	cs := client.NewConflictStore()
	cs.Add(client.ConflictItem{TaskID: "t1", Skill: &acp.SkillConflict{Name: "review", LocalPath: "/l", MulticaPath: "/m"}})
	srv := NewServer("0.1.1", q, cs)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/runtime/conflicts", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	var out []client.ConflictItem
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out) != 1 || out[0].Skill == nil || out[0].Skill.Name != "review" {
		t.Fatalf("unexpected conflicts: %+v", out)
	}
}
```

- [ ] **Step 2: 编写失败测试(TS store)**

`apps/desktop/src/renderer/src/stores/runtime-store.spec.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { deriveMode } from './runtime-store';

describe('deriveMode (L39)', () => {
  it('maps registered/busy to the three runtime modes', () => {
    expect(deriveMode(false, false)).toBe('local');
    expect(deriveMode(true, false)).toBe('runtime_registered');
    expect(deriveMode(true, true)).toBe('runtime_busy');
  });
});

describe('runtime store', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      jarvis: { invoke: vi.fn(async () => ({ registered: true, busy: false, activeTasks: 2, lastHeartbeatAt: 0, serverUrl: 'https://multica.example', protocol: 'acp', mode: 'runtime_registered' })) },
    });
  });
  it('refreshes status from the runtime.status IPC', async () => {
    const { useRuntimeStore } = await import('./runtime-store');
    const store = useRuntimeStore.getState();
    await store.refresh();
    expect(useRuntimeStore.getState().status?.serverUrl).toBe('https://multica.example');
    expect(useRuntimeStore.getState().status?.mode).toBe('runtime_registered');
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd daemon && go test ./internal/httpapi/ && cd apps/desktop && pnpm vitest run src/renderer/src/stores/runtime-store.spec.ts`
Expected: FAIL(端点/store 不存在)。

- [ ] **Step 4: 编写实现**

`daemon/internal/httpapi/server.go`(修改):`NewServer` 变 variadic 追加 `ServerExtra`;Server 存 `info RuntimeInfo`、`conflicts ConflictSource`;新增路由:
```go
// ServerExtra 携带 M7 runtime 状态(L39)与注入冲突(L38)数据源;nil 安全。
type ServerExtra interface{}

type RuntimeInfo interface {
	Registered() bool
	Busy() bool
	ActiveTasks() int
	LastHeartbeatAt() int64
	ServerURL() string
	CLIProtocol() string
}

type ConflictSource interface {
	Conflicts() []ConflictItem
}
```
(server.go 中 `type ConflictItem = client.ConflictItem` 或直接定义;为避免 httpapi 依赖 client 包造成的潜在循环(httpapi 不依赖 client),在 httpapi 内定义 `ConflictItem struct{ TaskID string; Skill *...; MCP *...; Resolved bool }`,并由 client.ConflictStore 通过小适配器满足 `ConflictSource`。为简洁,httpapi 内定义 `ConflictItem` 与 `client.ConflictItem` 同构,Task 8 的 ConflictStore 增加方法或由 main 组装适配。实现:httpapi 定义 `ConflictItem`,`ConflictSource` 返回 `[]ConflictItem`;client.ConflictStore 已有 `Conflicts() []client.ConflictItem`,通过适配 `conflictAdapter`(main 组装)转换。测试用 `srv := NewServer("0.1.1", q, cs)` 其中 cs 为满足 `ConflictSource` 的 fake。)

`/runtime/status` 处理:
```go
if s.info != nil {
	s.mux.HandleFunc("/runtime/status", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{
			"registered":     s.info.Registered(),
			"busy":           s.info.Busy(),
			"activeTasks":    s.info.ActiveTasks(),
			"lastHeartbeatAt": s.info.LastHeartbeatAt(),
			"serverUrl":      s.info.ServerURL(),
			"protocol":       s.info.CLIProtocol(),
		})
	})
}
```
`/runtime/conflicts`:
```go
if s.conflicts != nil {
	s.mux.HandleFunc("/runtime/conflicts", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, s.conflicts.Conflicts())
	})
}
```
(server.go 需 `writeJSON` helper;若 M3 已有则复用。)

为让 httpapi 测试编译:`NewServer("0.1.1", q, fakeRuntime{...})` 与 `NewServer("0.1.1", q, cs)` 均需 `ServerExtra` 断言。定义:
```go
type ServerExtra interface{}

func NewServer(version string, q *runtime.Queue, extras ...ServerExtra) *Server {
	s := &Server{version: version, q: q}
	for _, e := range extras {
		switch v := e.(type) {
		case RuntimeInfo:
			s.info = v
		case ConflictSource:
			s.conflicts = v
		}
	}
	...
}
```
httpapi 内定义本地 `ConflictItem`:
```go
type ConflictItem struct {
	TaskID   string             `json:"taskId"`
	Skill    *acp.SkillConflict `json:"skill,omitempty"`
	MCP      *acp.MCPConflict   `json:"mcp,omitempty"`
	Resolved bool               `json:"resolved"`
}
```
测试中 `cs := client.NewConflictStore()` 不直接满足 `httpapi.ConflictSource`(返回类型不同)。因此测试改为构造 `fakeConflicts`:
```go
type fakeConflicts struct{ items []ConflictItem }
func (f fakeConflicts) Conflicts() []ConflictItem { return f.items }
```
并在 `TestRuntimeConflictsEndpoint` 用 `fakeConflicts{items: []ConflictItem{{TaskID: "t1", Skill: &acp.SkillConflict{Name: "review", LocalPath: "/l", MulticaPath: "/m"}}}}`。httpapi 的 `ConflictItem.Skill` 用 `*acp.SkillConflict`(import acp)。

`apps/desktop/src/main/ipc/runtime.ts`:
```ts
import type { IpcMainInvokeEvent } from 'electron';

export interface RuntimeStatusData {
  registered: boolean;
  busy: boolean;
  activeTasks: number;
  lastHeartbeatAt: number;
  serverUrl: string;
  protocol: string;
  mode: 'local' | 'runtime_registered' | 'runtime_busy';
}

export function deriveRuntimeMode(registered: boolean, busy: boolean): RuntimeStatusData['mode'] {
  if (!registered) return 'local';
  return busy ? 'runtime_busy' : 'runtime_registered';
}

export interface ConflictItem {
  taskId: string;
  skill?: { name: string; localPath?: string; multicaPath?: string };
  mcp?: { name: string; localCommand?: string; multicaCommand?: string };
  resolved: boolean;
}

export function registerRuntimeHandlers(
  register: (channel: string, handler: (...args: any[]) => unknown) => void,
  getStatus: () => RuntimeStatusData | null,
  getConflicts: () => ConflictItem[],
  settings: { get(key: string): unknown; set(key: string, value: unknown): void },
): void {
  register('runtime.status', () => getStatus());
  register('runtime.conflicts', () => getConflicts());
  register('runtime.resolveConflict', (_e: IpcMainInvokeEvent, arg: { name: string; decision: string }) => {
    const existing = (settings.get('multica.conflicts') ?? {}) as Record<string, string>;
    existing[arg.name] = arg.decision;
    settings.set('multica.conflicts', existing);
    return { ok: true };
  });
}
```

`apps/desktop/src/main/ipc/runtime.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { registerRuntimeHandlers, deriveRuntimeMode, type RuntimeStatusData } from './runtime';

describe('runtime ipc', () => {
  it('exposes status/conflicts and persists conflict decisions', async () => {
    const calls = new Map<string, unknown[]>();
    const settings = new Map<string, unknown>();
    const register = (ch: string, h: (...a: any[]) => unknown) => calls.set(ch, [h]);
    const status: RuntimeStatusData = { registered: true, busy: false, activeTasks: 0, lastHeartbeatAt: 0, serverUrl: 's', protocol: 'acp', mode: 'runtime_registered' };
    registerRuntimeHandlers(
      register,
      () => status,
      () => [],
      { get: (k) => settings.get(k), set: (k, v) => void settings.set(k, v) },
    );
    const statusH = calls.get('runtime.status')?.[0] as () => RuntimeStatusData;
    expect(statusH().mode).toBe('runtime_registered');
    const resolveH = calls.get('runtime.resolveConflict')?.[0] as (e: unknown, a: { name: string; decision: string }) => unknown;
    await resolveH({}, { name: 'review', decision: 'local' });
    expect((settings.get('multica.conflicts') as Record<string, string>).review).toBe('local');
  });
  it('derives the three modes', () => {
    expect(deriveRuntimeMode(false, false)).toBe('local');
    expect(deriveRuntimeMode(true, false)).toBe('runtime_registered');
    expect(deriveRuntimeMode(true, true)).toBe('runtime_busy');
  });
});
```

`apps/desktop/src/renderer/src/stores/runtime-store.ts`:
```ts
import { create } from 'zustand';

export type RuntimeMode = 'local' | 'runtime_registered' | 'runtime_busy';

export interface RuntimeStatus {
  registered: boolean;
  busy: boolean;
  activeTasks: number;
  lastHeartbeatAt: number;
  serverUrl: string;
  protocol: string;
  mode: RuntimeMode;
}

export function deriveMode(registered: boolean, busy: boolean): RuntimeMode {
  if (!registered) return 'local';
  return busy ? 'runtime_busy' : 'runtime_registered';
}

interface RuntimeStore {
  status: RuntimeStatus | null;
  refresh: () => Promise<void>;
}

export const useRuntimeStore = create<RuntimeStore>((set) => ({
  status: null,
  refresh: async () => {
    const s = (await window.jarvis.invoke('runtime.status')) as RuntimeStatus;
    set({ status: s });
  },
}));
```

`apps/desktop/src/main/daemon/DaemonSupervisor.ts`(修改,增加轮询与缓存):
```ts
export interface RuntimeStatusData {
  registered: boolean;
  busy: boolean;
  activeTasks: number;
  lastHeartbeatAt: number;
  serverUrl: string;
  protocol: string;
  mode: 'local' | 'runtime_registered' | 'runtime_busy';
}
// DaemonSupervisor 增加:runtimeStatusCache / conflictCache,轮询 GET /runtime/status 与 /runtime/conflicts(3s),
// 并提供 getRuntimeStatus()/getRuntimeConflicts()。daemon 不可达时返回 { registered:false, mode:'local', ... } 默认值。
```

`apps/desktop/src/main/ipc/IpcRouter.ts`(修改):
```ts
import { registerRuntimeHandlers, deriveRuntimeMode } from './runtime';
// 构造时:
registerRuntimeHandlers(
  (ch, h) => this.register(ch, h),
  () => this.daemonSupervisor.getRuntimeStatus(),
  () => this.daemonSupervisor.getRuntimeConflicts(),
  { get: (k) => this.settingsGet(k), set: (k, v) => this.settingsSet(k, v) },
);
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd daemon && go test ./internal/httpapi/ && cd apps/desktop && pnpm vitest run src/main/ipc/runtime.spec.ts src/renderer/src/stores/runtime-store.spec.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add daemon/internal/httpapi/server.go daemon/internal/httpapi/runtime_status_test.go apps/desktop/src/main/ipc/runtime.ts apps/desktop/src/main/ipc/runtime.spec.ts apps/desktop/src/main/ipc/IpcRouter.ts apps/desktop/src/main/daemon/DaemonSupervisor.ts apps/desktop/src/renderer/src/stores/runtime-store.ts apps/desktop/src/renderer/src/stores/runtime-store.spec.ts
git commit -m "feat(multica): runtime status API, IPC and store (L39 data plane)"
```

---

### Task 10: Runtime UI — ModeIndicator + RuntimeStatusView + SkillsMerger(L39/L38 UI + i18n)

**Files:**
- Create: `apps/desktop/src/renderer/src/components/runtime/ModeIndicator.tsx`
- Create: `apps/desktop/src/renderer/src/components/runtime/ModeIndicator.spec.tsx`
- Create: `apps/desktop/src/renderer/src/components/runtime/RuntimeStatusView.tsx`
- Create: `apps/desktop/src/renderer/src/components/runtime/RuntimeStatusView.spec.tsx`
- Create: `apps/desktop/src/renderer/src/components/runtime/SkillsMerger.tsx`
- Create: `apps/desktop/src/renderer/src/components/runtime/SkillsMerger.spec.tsx`
- Modify: `apps/desktop/src/renderer/src/i18n`(zh-CN/en 资源)、导航/路由(挂载 RuntimeStatusView + SkillsMerger)

**Interfaces:**
- Consumes: Task 9 `useRuntimeStore`、`deriveMode`、`RuntimeMode`;IPC `runtime.conflicts`/`runtime.resolveConflict`。
- Produces:
  - `ModeIndicator({ mode })` — 三态圆点 + 标签(L39)。
  - `RuntimeStatusView()` — 轮询 status;展示注册状态、协议族、CLI 版本、心跳时间、活跃 Multica Task 数;内嵌 ModeIndicator(原型 13/L39)。
  - `SkillsMerger()` — 读取 `runtime.conflicts`,未解决项提供 本地|下发|合并 三按钮,点击写 `runtime.resolveConflict`(L38)。
  - i18n keys:`runtime.mode.local|runtime_registered|runtime_busy`、`runtime.protocol/server/heartbeat/activeTasks/registered`、`runtime.skillsMerger.title/none/local/multica/merge`。

- [ ] **Step 1: 编写失败测试**

`apps/desktop/src/renderer/src/components/runtime/ModeIndicator.spec.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModeIndicator, type RuntimeMode } from './ModeIndicator';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18n from 'i18next';

describe('ModeIndicator (L39)', () => {
  beforeEach(() => {
    i18n.use(initReactI18next).init({ lng: 'zh-CN', resources: { 'zh-CN': { common: { runtime: { mode: { local: '本地模式', runtime_registered: 'Runtime 已注册', runtime_busy: 'Runtime 忙碌' } } } } } });
  });
  it.each<RuntimeMode>(['local', 'runtime_registered', 'runtime_busy'])('renders mode %s', (mode) => {
    render(<I18nextProvider i18n={i18n}><ModeIndicator mode={mode} /></I18nextProvider>);
    expect(screen.getByTestId('mode-indicator')).toBeTruthy();
  });
});
```

`apps/desktop/src/renderer/src/components/runtime/RuntimeStatusView.spec.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import { RuntimeStatusView } from './RuntimeStatusView';

describe('RuntimeStatusView', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      jarvis: { invoke: vi.fn(async () => ({ registered: true, busy: false, activeTasks: 2, lastHeartbeatAt: 0, serverUrl: 'https://multica.example', protocol: 'acp', mode: 'runtime_registered' })) },
    });
  });
  it('renders runtime registration status', async () => {
    render(<I18nextProvider i18n={i18n}><RuntimeStatusView /></I18nextProvider>);
    expect(await screen.findByTestId('runtime-status')).toBeTruthy();
  });
});
```

`apps/desktop/src/renderer/src/components/runtime/SkillsMerger.spec.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import { SkillsMerger } from './SkillsMerger';

describe('SkillsMerger (L38)', () => {
  const invoke = vi.fn(async (ch: string) => {
    if (ch === 'runtime.conflicts') {
      return [{ taskId: 't1', skill: { name: 'review', localPath: '/l', multicaPath: '/m' }, resolved: false }];
    }
    return { ok: true };
  });
  beforeEach(() => {
    invoke.mockClear();
    vi.stubGlobal('window', { jarvis: { invoke } });
  });
  it('shows a conflict and resolves via IPC', async () => {
    render(<I18nextProvider i18n={i18n}><SkillsMerger /></I18nextProvider>);
    expect(await screen.findByTestId('conflict-item')).toBeTruthy();
    fireEvent.click(screen.getAllByText('本地')[0]);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('runtime.resolveConflict', { name: 'review', decision: 'local' }));
  });
});
```
(i18n 需含 `runtime.skillsMerger.local = "本地"`。)

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/components/runtime/ModeIndicator.spec.tsx src/renderer/src/components/runtime/RuntimeStatusView.spec.tsx src/renderer/src/components/runtime/SkillsMerger.spec.tsx`
Expected: FAIL(组件不存在)。

- [ ] **Step 3: 编写实现**

`apps/desktop/src/renderer/src/components/runtime/ModeIndicator.tsx`:
```tsx
import { useTranslation } from 'react-i18next';

export type RuntimeMode = 'local' | 'runtime_registered' | 'runtime_busy';

const DOT: Record<RuntimeMode, string> = {
  local: 'bg-slate-400',
  runtime_registered: 'bg-green-500',
  runtime_busy: 'bg-amber-500',
};

export function ModeIndicator({ mode }: { mode: RuntimeMode }) {
  const { t } = useTranslation('common');
  return (
    <span data-testid="mode-indicator" className="inline-flex items-center gap-1.5 text-xs">
      <span data-testid="mode-dot" className={`h-2 w-2 rounded-full ${DOT[mode]}`} />
      {t(`runtime.mode.${mode}`)}
    </span>
  );
}
```

`apps/desktop/src/renderer/src/components/runtime/RuntimeStatusView.tsx`:
```tsx
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useRuntimeStore } from '../../stores/runtime-store';
import { ModeIndicator, type RuntimeMode } from './ModeIndicator';

export function RuntimeStatusView() {
  const { t } = useTranslation('common');
  const status = useRuntimeStore((s) => s.status);
  const refresh = useRuntimeStore((s) => s.refresh);
  useEffect(() => {
    void refresh();
    const iv = setInterval(() => void refresh(), 3000);
    return () => clearInterval(iv);
  }, [refresh]);
  if (!status) return <div data-testid="runtime-status" />;
  const mode: RuntimeMode = status.mode;
  return (
    <div data-testid="runtime-status" className="space-y-2 p-4">
      <ModeIndicator mode={mode} />
      <p data-testid="runtime-registered">{t('runtime.registered', { v: status.registered ? 'yes' : 'no' })}</p>
      <p>{t('runtime.protocol')}: {status.protocol}</p>
      <p>{t('runtime.server')}: {status.serverUrl || '-'}</p>
      <p>{t('runtime.heartbeat')}: {status.lastHeartbeatAt ? new Date(status.lastHeartbeatAt).toLocaleTimeString() : '-'}</p>
      <p>{t('runtime.activeTasks')}: {status.activeTasks}</p>
    </div>
  );
}
```

`apps/desktop/src/renderer/src/components/runtime/SkillsMerger.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface ConflictItem {
  taskId: string;
  skill?: { name: string; localPath?: string; multicaPath?: string };
  mcp?: { name: string; localCommand?: string; multicaCommand?: string };
  resolved: boolean;
}

export function SkillsMerger() {
  const { t } = useTranslation('common');
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const refresh = async () => setConflicts((await window.jarvis.invoke('runtime.conflicts')) as ConflictItem[]);
  useEffect(() => { void refresh(); }, []);
  const nameOf = (c: ConflictItem) => c.skill?.name ?? c.mcp?.name ?? '';
  const resolve = async (c: ConflictItem, decision: 'local' | 'multica' | 'merge') => {
    await window.jarvis.invoke('runtime.resolveConflict', { name: nameOf(c), decision });
    void refresh();
  };
  const pending = conflicts.filter((c) => !c.resolved);
  return (
    <div data-testid="skills-merger">
      <h3>{t('runtime.skillsMerger.title')}</h3>
      {pending.length === 0 && <p data-testid="no-conflicts">{t('runtime.skillsMerger.none')}</p>}
      <ul>
        {pending.map((c) => (
          <li key={nameOf(c)} data-testid="conflict-item">
            <span>{nameOf(c)}</span>
            <button onClick={() => void resolve(c, 'local')}>{t('runtime.skillsMerger.local')}</button>
            <button onClick={() => void resolve(c, 'multica')}>{t('runtime.skillsMerger.multica')}</button>
            <button onClick={() => void resolve(c, 'merge')}>{t('runtime.skillsMerger.merge')}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

i18n 资源(zh-CN):
```json
"runtime": {
  "mode": { "local": "本地模式", "runtime_registered": "Runtime 已注册", "runtime_busy": "Runtime 忙碌" },
  "registered": "注册状态: {{v}}",
  "protocol": "协议",
  "server": "Multica Server",
  "heartbeat": "最近心跳",
  "activeTasks": "活跃 Multica 任务",
  "skillsMerger": { "title": "Skills/MCP 注入冲突", "none": "无冲突", "local": "本地", "multica": "下发", "merge": "合并(改名)" }
}
```
en:
```json
"runtime": {
  "mode": { "local": "Local mode", "runtime_registered": "Runtime registered", "runtime_busy": "Runtime busy" },
  "registered": "Registered: {{v}}",
  "protocol": "Protocol",
  "server": "Multica Server",
  "heartbeat": "Last heartbeat",
  "activeTasks": "Active Multica tasks",
  "skillsMerger": { "title": "Skills/MCP injection conflicts", "none": "No conflicts", "local": "Local", "multica": "Remote", "merge": "Merge (rename)" }
}
```

导航/路由:在设置或 Daemon 管理页挂载 `<RuntimeStatusView />` 与 `<SkillsMerger />`(挂载位置参考原型 13 Multica 状态页)。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/desktop && pnpm vitest run src/renderer/src/components/runtime/ModeIndicator.spec.tsx src/renderer/src/components/runtime/RuntimeStatusView.spec.tsx src/renderer/src/components/runtime/SkillsMerger.spec.tsx && cd /Users/baofengbaofeng/Workspace/github/baofengbaofeng/Jarvis && node scripts/i18n-check.mjs`
Expected: PASS + 对称。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/components/runtime apps/desktop/src/renderer/src/stores/runtime-store.ts apps/desktop/src/renderer/src/i18n
git commit -m "feat(multica): runtime mode indicator, status view and skills merger UI (L39/L38)"
```

---

### M7 验收清单(Self-Review 对照)

**§21 M7 交付(M7 Runtime | jarvis-agent CLI、ACP、Multica 联调 | S6 场景):**
- [x] jarvis-agent CLI — Task 1(cobra --version/--health)+ Task 2(--list-models)+ Task 6(run)
- [x] ACP — Task 3(§Wire TaskPayload)+ Task 7/8(ClientAPI + HTTPClientAPI + 接单闭环)
- [x] Multica 联调(数据面) — Task 8(注册/心跳/轮询/接单/回传)+ Task 9(/runtime/status + IPC);真实 Server 互操作属 S6 外部联调

**§10.6 M7 行(H1.1–H1.14,H3,L35–L36,L38–L39):**
- [x] H1.1 CLI PATH 可探测 — Task 1/8(subprocessAgentInvoker 经 PATH 调 jarvis-agent)
- [x] H1.2 ACP 协议族兼容 — Task 3 + §Wire
- [x] H1.3 接收 Task 上下文 — Task 3(BuildInitialMessages)
- [x] H1.4 流式回传 — Task 5(StreamWriter)+ Task 8(onChunk→StreamProgress/SendResult)
- [x] H1.5 会话恢复 --conversation — Task 6(HistoryLoader + ExecuteTask 前置)
- [x] H1.6 注入 MCP 配置 — Task 4/8(MCPServers merge)
- [x] H1.7 注入 Skills — Task 8(applyInjection 落盘 .jarvis/skills/)
- [x] H1.8 环境变量/CLI 参数 — Task 4/6(Env/CLIArgs merge + RunSpec)
- [x] H1.9 模型列表 — Task 2(ListModels + --list-models)
- [x] H1.10 Daemon 15s 心跳 + 3s 轮询 — Task 7(Client.Serve)+ Task 8(main 组装)
- [x] H1.11 并发 6/20 — Task 8(runtime.Queue 复用)
- [x] H1.12 独立 workspace — Task 5/6/8(WorkspacePool)
- [x] H1.13 生命周期 queued→running→completed/failed — Task 8(ClaimHandler + Queue)
- [x] H1.14 自定义 Runtime Profile — Task 2/6(ProfileStore + Env 注入)
- [x] H3 协议族对齐(ACP 首选) — §Wire + Task 7(HTTPClientAPI)
- [x] L35 cobra CLI --version/--health/--list-models — Task 1/2
- [x] L36 tasks.multica_task_id 唯一索引 — Task 6(migration v5 + MapTaskIDs)
- [x] L38 Skills/MCP 冲突检测 + UI — Task 4(MergeInjections)+ Task 8(ConflictStore)+ Task 10(SkillsMerger)
- [x] L39 ModeIndicator local|runtime_registered|runtime_busy — Task 9(deriveMode)+ Task 10(ModeIndicator/RuntimeStatusView)

**S6 场景验收(端到端,需真实/模拟 Multica Server + Node + core bundle,外部):** 启动 daemon(`JARVIS_MULTICA_SERVER` 指向 Server)→ `jarvis-agent --health` 返回 ok → daemon 注册(`/runtime/status.registered=true`)→ 15s 心跳 / 3s 轮询 → Server 下发 Task → daemon 接单(ack true)→ 经 Queue(6/20)执行 jarvis-agent run(真实 Node headless 跑 core)→ 流式回传 progress/result → 完成后 UI 显示 runtime_registered→runtime_busy 切换、活跃任务数、最近心跳;`runtime.conflicts` 出现注入冲突时 SkillsMerger 三选一;`tasks.multica_task_id` 唯一索引生效,双向映射可查。

**M7 已知后置:** 冲突决策(`multica.conflicts` settings)接入 Go `MergeInjections` 策略(当前默认本地优先);`jarvis-agent --health` 的 daemon 探活接入 daemon URL;F12 cron/事件触发(M8);H2 Client 产品功能(OAuth/Issue/Autopilot)明确排除(Q2:A);DAG 工作流 UI 可视化编辑器(M8 K6);系统级全局能力(A3/I1–I4,V2.0)。
