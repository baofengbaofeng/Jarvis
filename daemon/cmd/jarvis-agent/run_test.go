package main

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"io"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/db"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/acp"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/client"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/policy"
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

func (f *fakeRecorder) Record(_ context.Context, local, multica, _ string) error {
	f.calls = append(f.calls, [2]string{local, multica})
	return nil
}

type failingRecorder struct{ err error }

func (f *failingRecorder) Record(context.Context, string, string, string) error { return f.err }

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

func TestExecuteTaskProfileEnvOverridesPayloadEnv(t *testing.T) {
	runner := &fakeRunner{res: RunResult{Status: "completed", Result: "ok"}}
	prof := &db.Profile{ID: "dev", Env: map[string]string{"LOG_LEVEL": "debug", "SHARED": "profile"}}
	deps, _ := testDeps(runner, &fakeHistory{}, &fakeRecorder{}, &fakeProfiles{prof: prof})
	deps.InjectionPolicy = allowingPolicy{env: map[string]string{"LOG_LEVEL": "info", "PAYLOAD_ONLY": "yes"}}
	var buf bytes.Buffer
	payload := &acp.TaskPayload{
		TaskID:      "t-5",
		Instruction: "go",
		Profile:     "dev",
		Env:         map[string]string{"LOG_LEVEL": "info", "PAYLOAD_ONLY": "yes"},
	}
	if err := ExecuteTask(context.Background(), deps, payload, TaskOpts{}, runtime.NewStreamWriter(&buf)); err != nil {
		t.Fatal(err)
	}
	env := runner.specs[0].Env
	if env["LOG_LEVEL"] != "debug" {
		t.Fatalf("profile env should win over payload env, got %q", env["LOG_LEVEL"])
	}
	if env["SHARED"] != "profile" || env["PAYLOAD_ONLY"] != "yes" {
		t.Fatalf("unexpected merged env: %+v", env)
	}
}

type rejectingPolicy struct {
	denial   policy.Denial
	approval policy.ApprovalRequest
}

func (r rejectingPolicy) Evaluate(_ context.Context, _ policy.CandidateInjection) (acp.Injection, []policy.Denial, []policy.ApprovalRequest, error) {
	if r.approval.Key.Digest != "" || r.approval.Key.Name != "" {
		return acp.Injection{}, nil, []policy.ApprovalRequest{r.approval}, nil
	}
	if r.denial.Reason != "" {
		return acp.Injection{}, []policy.Denial{r.denial}, nil, nil
	}
	return acp.Injection{}, nil, nil, nil
}

type allowingPolicy struct {
	env map[string]string
}

func (a allowingPolicy) Evaluate(_ context.Context, c policy.CandidateInjection) (acp.Injection, []policy.Denial, []policy.ApprovalRequest, error) {
	env := a.env
	if env == nil {
		env = c.Env
	}
	return acp.Injection{Env: env, MCPServers: c.MCPServers, CLIArgs: c.CLIArgs, Skills: c.Skills}, nil, nil, nil
}

func TestExecuteTaskDoesNotRunUnapprovedRemoteMCP(t *testing.T) {
	runner := &fakeRunner{res: RunResult{Status: "completed"}}
	deps, _ := testDeps(runner, &fakeHistory{}, &fakeRecorder{}, &fakeProfiles{})
	deps.InjectionPolicy = rejectingPolicy{approval: policy.ApprovalRequest{
		Key: policy.ApprovalKey{Kind: "mcp", Name: "remote", Digest: "abc"},
	}}
	payload := &acp.TaskPayload{
		TaskID: "t-policy", Instruction: "go",
		MCPServers: []acp.MCPEntry{{Name: "remote", Command: "/tmp/remote"}},
	}
	err := ExecuteTask(context.Background(), deps, payload, TaskOpts{}, runtime.NewStreamWriter(io.Discard))
	if err == nil || !strings.Contains(err.Error(), "MULTICA_INJECTION_APPROVAL_REQUIRED") {
		t.Fatalf("err=%v", err)
	}
	if len(runner.specs) != 0 {
		t.Fatal("runner must not receive an unapproved injection")
	}
}

func TestExecuteTaskDoesNotRunDeniedRemoteEnv(t *testing.T) {
	runner := &fakeRunner{res: RunResult{Status: "completed"}}
	deps, _ := testDeps(runner, &fakeHistory{}, &fakeRecorder{}, &fakeProfiles{})
	deps.InjectionPolicy = rejectingPolicy{denial: policy.Denial{Kind: "env", Name: "NODE_OPTIONS", Reason: "DANGEROUS_ENV"}}
	payload := &acp.TaskPayload{
		TaskID: "t-deny", Instruction: "go",
		Env: map[string]string{"NODE_OPTIONS": "--require /tmp/pwn.js"},
	}
	err := ExecuteTask(context.Background(), deps, payload, TaskOpts{}, runtime.NewStreamWriter(io.Discard))
	if err == nil || !strings.Contains(err.Error(), "MULTICA_INJECTION_DENIED") {
		t.Fatalf("err=%v", err)
	}
	if len(runner.specs) != 0 {
		t.Fatal("runner must not receive a denied injection")
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

// mustTasksTable creates the main-owned tasks table (same shape migration v1 +
// v9 produce) with NO pre-existing rows, for the C1 claim-chain regression.
func mustTasksTable(t *testing.T, d *sql.DB) {
	t.Helper()
	if _, err := d.Exec(`CREATE TABLE tasks (
		id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
		payload_json TEXT NOT NULL, result_json TEXT, error_json TEXT,
		multica_task_id TEXT UNIQUE, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT
	)`); err != nil {
		t.Fatal(err)
	}
}

// TestExecuteTaskRecordsMappingAgainstRealSQLite is the C1 regression at the
// ExecuteTask level: against a SQLite DB with NO pre-existing tasks row, the
// L36 mapping must persist and the streamed result must be completed (not
// failed). Before the fix, sqliteTaskRecorder.Record -> MapTaskIDs hit
// RowsAffected==0 and ExecuteTask returned an error after streaming the result.
func TestExecuteTaskRecordsMappingAgainstRealSQLite(t *testing.T) {
	d, err := db.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	mustTasksTable(t, d)

	runner := &fakeRunner{res: RunResult{Status: "completed", Result: "done", Model: "m1"}}
	deps, _ := testDeps(runner, &fakeHistory{}, &sqliteTaskRecorder{d: d}, &fakeProfiles{})
	var buf bytes.Buffer
	sw := runtime.NewStreamWriter(&buf)

	payload := &acp.TaskPayload{TaskID: "t-9", MulticaTaskID: "mt-9", Instruction: "fix it"}
	if err := ExecuteTask(context.Background(), deps, payload, TaskOpts{LocalTaskID: "local-9"}, sw); err != nil {
		t.Fatalf("ExecuteTask should not fail when the recorder ensures the row: %v", err)
	}
	if !bytes.Contains(buf.Bytes(), []byte(`"status":"completed"`)) {
		t.Fatalf("expected completed result frame: %s", buf.String())
	}
	got, err := db.MulticaTaskIDByLocal(context.Background(), d, "local-9")
	if err != nil {
		t.Fatal(err)
	}
	if got != "mt-9" {
		t.Fatalf("mapping not persisted: got %q", got)
	}
}

// TestExecuteTaskRecordFailureIsNonFatal proves a Record failure logs but does
// not fail an otherwise-completed task (C1 "Also reconsider").
func TestExecuteTaskRecordFailureIsNonFatal(t *testing.T) {
	runner := &fakeRunner{res: RunResult{Status: "completed", Result: "done", Model: "m1"}}
	rec := &failingRecorder{err: errors.New("db closed")}
	deps, _ := testDeps(runner, &fakeHistory{}, rec, &fakeProfiles{})
	var buf bytes.Buffer
	sw := runtime.NewStreamWriter(&buf)

	payload := &acp.TaskPayload{TaskID: "t-10", MulticaTaskID: "mt-10", Instruction: "go"}
	if err := ExecuteTask(context.Background(), deps, payload, TaskOpts{LocalTaskID: "local-10"}, sw); err != nil {
		t.Fatalf("record failure should not fail the task: %v", err)
	}
	if !bytes.Contains(buf.Bytes(), []byte(`"status":"completed"`)) {
		t.Fatalf("expected completed result frame despite record failure: %s", buf.String())
	}
}

// chainAPI is a minimal client.ClientAPI that records the terminal result.
type chainAPI struct {
	mu      sync.Mutex
	results []client.TaskResult
}

func (f *chainAPI) Register(context.Context, client.RegisterRequest) (client.RegisterResponse, error) {
	return client.RegisterResponse{ClientID: "c1", HeartbeatSec: 15, PollSec: 3}, nil
}
func (f *chainAPI) Heartbeat(context.Context, string, client.HeartbeatStatus) error { return nil }
func (f *chainAPI) Poll(context.Context, string) ([]client.ClaimedTask, error)      { return nil, nil }
func (f *chainAPI) StreamProgress(context.Context, string, string, runtime.StreamChunk) error {
	return nil
}
func (f *chainAPI) SendResult(_ context.Context, _, _ string, r client.TaskResult) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.results = append(f.results, r)
	return nil
}
func (f *chainAPI) Ack(context.Context, string, string, bool) error { return nil }

func (f *chainAPI) resultCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.results)
}

// TestClaimToExecuteTaskChainRealSQLite is the C1 regression over the real chain
// (claim -> ExecuteTask -> Record -> result): a claimed task handled against a
// SQLite DB with NO pre-existing tasks row must end with a completed result (not
// failed) and a persisted L36 mapping.
func TestClaimToExecuteTaskChainRealSQLite(t *testing.T) {
	d, err := db.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	mustTasksTable(t, d)

	q := runtime.NewQueue(1, 2)
	api := &chainAPI{}
	handler := &client.ClaimHandler{
		API:      api,
		Queue:    q,
		ClientID: func() string { return "c1" },
		Exec: func(ctx context.Context, p *acp.TaskPayload, onChunk func(runtime.StreamChunk)) (client.TaskResult, error) {
			// Emulate SubprocessAgentInvoker.RunTask: run ExecuteTask (which records
			// the L36 mapping via sqliteTaskRecorder) and forward the outcome.
			deps := RunDeps{
				Runner:   &fakeRunner{res: RunResult{Status: "completed", Result: "done", Model: "m1"}},
				History:  &fakeHistory{},
				Recorder: &sqliteTaskRecorder{d: d},
				Pool:     runtime.NewWorkspacePoolFS("/ws", &memPoolFS{}),
				Profiles: &fakeProfiles{},
			}
			var buf bytes.Buffer
			if err := ExecuteTask(ctx, deps, p, TaskOpts{LocalTaskID: p.TaskID}, runtime.NewStreamWriter(&buf)); err != nil {
				return client.TaskResult{Status: "failed", Error: err.Error()}, err
			}
			return client.TaskResult{Status: "completed", Result: "done", Model: "m1", FinishedAt: time.Now().Unix()}, nil
		},
	}
	task := client.ClaimedTask{TaskID: "t-chain", MulticaTaskID: "mt-chain", Payload: []byte(`{"taskId":"t-chain","multicaTaskId":"mt-chain","instruction":"fix it"}`)}
	if err := handler.HandleClaims(context.Background(), []client.ClaimedTask{task}); err != nil {
		t.Fatal(err)
	}
	deadline := time.After(2 * time.Second)
	for api.resultCount() < 1 {
		select {
		case <-deadline:
			t.Fatal("no result sent")
		case <-time.After(10 * time.Millisecond):
		}
	}
	if got := api.results[0].Status; got != "completed" {
		t.Fatalf("result not completed: %+v", api.results[0])
	}
	got, err := db.MulticaTaskIDByLocal(context.Background(), d, "t-chain")
	if err != nil {
		t.Fatal(err)
	}
	if got != "mt-chain" {
		t.Fatalf("mapping not persisted: got %q", got)
	}
}

func TestParseResultFramesLastResultWins(t *testing.T) {
	input := `{"type":"delta","delta":"partial"}
{"type":"result","status":"completed","result":"done","model":"m1"}
{"type":"result","status":"completed","result":"overwritten","model":"m2"}
`
	res, err := parseResultFrames(strings.NewReader(input))
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != "completed" || res.Result != "overwritten" || res.Model != "m2" {
		t.Fatalf("unexpected result: %+v", res)
	}
}

func TestParseResultFramesLargeFrame(t *testing.T) {
	big := strings.Repeat("x", 128*1024) // 128KB > bufio.Scanner's 64KB cap
	input := `{"type":"result","status":"completed","result":"` + big + `","model":"m1"}` + "\n"
	res, err := parseResultFrames(strings.NewReader(input))
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != "completed" || len(res.Result) != len(big) {
		t.Fatalf("large frame truncated: len=%d want=%d", len(res.Result), len(big))
	}
}

func TestParseResultFramesNoResultIsFailed(t *testing.T) {
	input := `{"type":"delta","delta":"partial"}` + "\n"
	res, err := parseResultFrames(strings.NewReader(input))
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != "failed" || res.Error != "core produced no result frame" {
		t.Fatalf("expected failed result, got: %+v", res)
	}
}

func TestParseResultFramesSkipsNoiseLines(t *testing.T) {
	input := "some non-JSON noise line\n{\"type\":\"result\",\"status\":\"completed\",\"result\":\"ok\"}\n"
	res, err := parseResultFrames(strings.NewReader(input))
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != "completed" || res.Result != "ok" {
		t.Fatalf("unexpected result: %+v", res)
	}
}

// memPoolFS implements runtime.WorkspaceFS in-memory.
type memPoolFS struct{}

func (m *memPoolFS) MkdirAll(string, os.FileMode) error { return nil }
func (m *memPoolFS) RemoveAll(string) error             { return nil }
func (m *memPoolFS) Stat(string) (os.FileInfo, error)   { return nil, nil }
