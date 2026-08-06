package main

import (
	"context"
	"os"
	"sync"
	"testing"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/acp"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/client"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"
)

// fakeInvoker records the payload it was asked to run and returns a completed
// result, standing in for SubprocessAgentInvoker in the C2 wiring test.
type fakeInvoker struct {
	mu      sync.Mutex
	payload *acp.TaskPayload
}

func (f *fakeInvoker) RunTask(_ context.Context, p *acp.TaskPayload, _ func(runtime.StreamChunk)) (client.TaskResult, error) {
	f.mu.Lock()
	f.payload = p
	f.mu.Unlock()
	return client.TaskResult{Status: "completed", Result: "ok"}, nil
}

// memSkillFS records skill-copy operations for the C2 wiring test.
type memSkillFS struct {
	copies [][2]string
	dirs   []string
}

func (m *memSkillFS) ReadDir(string) ([]string, error) { return nil, nil }
func (m *memSkillFS) Copy(src, dst string) error {
	m.copies = append(m.copies, [2]string{src, dst})
	return nil
}
func (m *memSkillFS) MkdirAll(d string) error {
	m.dirs = append(m.dirs, d)
	return nil
}

// memPoolFS implements runtime.WorkspaceFS in-memory.
type memPoolFS struct{}

func (m *memPoolFS) MkdirAll(string, os.FileMode) error { return nil }
func (m *memPoolFS) RemoveAll(string) error             { return nil }
func (m *memPoolFS) Stat(string) (os.FileInfo, error)   { return nil, nil }

// TestAgentExecWiresInjection is the C2 regression: the daemon's exec path must
// allocate a task workspace, apply the injection (copy the claimed skill into
// .jarvis/skills), record the L38 conflict, and hand the MERGED payload (skills
// cleared) to the invoker — not the raw payload.
func TestAgentExecWiresInjection(t *testing.T) {
	st := &runtimeState{q: runtime.NewQueue(1, 2)}
	inv := &fakeInvoker{}
	fs := &memSkillFS{}
	cs := client.NewConflictStore()
	pool := runtime.NewWorkspacePoolFS("/ws", &memPoolFS{})

	local := acp.Injection{Skills: []acp.SkillSpec{{Source: "local", Name: "review", Path: "/ws/local/review"}}}
	exec := agentExec(inv, st, pool, fs, cs, local)

	p := &acp.TaskPayload{TaskID: "t1", MulticaTaskID: "mt1", Instruction: "x", Skills: []string{"review"}}
	res, err := exec(context.Background(), p, nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != "completed" {
		t.Fatalf("unexpected result: %+v", res)
	}

	inv.mu.Lock()
	got := inv.payload
	inv.mu.Unlock()
	if got == nil {
		t.Fatal("invoker not called with a payload")
	}
	// The invoker receives the MERGED payload: skills cleared (copied to disk),
	// multica task id preserved.
	if got.Skills != nil {
		t.Fatalf("expected merged payload with skills cleared, got %+v", got)
	}
	if got.MulticaTaskID != "mt1" {
		t.Fatalf("merged payload lost multica id: %+v", got)
	}

	// H1.7: the claimed skill was copied into the workspace .jarvis/skills dir.
	if len(fs.copies) != 1 || fs.copies[0][1] != "/ws/t1/.jarvis/skills/review" {
		t.Fatalf("skill not copied to .jarvis/skills: %v", fs.copies)
	}
	if len(fs.dirs) != 1 || fs.dirs[0] != "/ws/t1/.jarvis/skills" {
		t.Fatalf("skills dir not created: %v", fs.dirs)
	}

	// L38: the name collision (local review vs multica review) is recorded.
	conflicts := cs.Conflicts()
	if len(conflicts) != 1 {
		t.Fatalf("expected 1 recorded conflict, got %+v", conflicts)
	}
	if conflicts[0].TaskID != "t1" || conflicts[0].Skill == nil || conflicts[0].Skill.Name != "review" {
		t.Fatalf("unexpected recorded conflict: %+v", conflicts[0])
	}
}
