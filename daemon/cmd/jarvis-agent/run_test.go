package main

import (
	"bytes"
	"context"
	"errors"
	"os"
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
