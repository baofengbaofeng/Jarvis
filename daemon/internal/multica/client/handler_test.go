package client

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/acp"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"
)

type recordingAPI struct {
	mu      sync.Mutex
	acks    []bool
	streams []runtime.StreamChunk
	results []TaskResult
	tasks   []ClaimedTask
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

// fakeRecorder is a local TaskRecorder stub (package client, distinct from the
// package main type in cmd/jarvis-agent).
type fakeRecorder struct{ calls [][2]string }

func (f *fakeRecorder) Record(context.Context, string, string) error { return nil }

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

// TestHandleClaimsPerAgentCap proves all claimed tasks share one queue agent slot
// so the per-agent concurrency cap binds across tasks (H1.11, review round 1).
func TestHandleClaimsPerAgentCap(t *testing.T) {
	f := &recordingAPI{tasks: []ClaimedTask{
		{TaskID: "t1", MulticaTaskID: "mt1", Payload: []byte(`{"taskId":"t1","instruction":"a"}`)},
		{TaskID: "t2", MulticaTaskID: "mt2", Payload: []byte(`{"taskId":"t2","instruction":"b"}`)},
	}}
	q := runtime.NewQueue(1, 2) // per-agent cap 1, machine cap 2
	var mu sync.Mutex
	active, maxActive := 0, 0
	h := &ClaimHandler{
		API:      f,
		Queue:    q,
		ClientID: func() string { return "c1" },
		AgentID:  "jarvis",
		Exec: func(_ context.Context, _ *acp.TaskPayload, _ func(runtime.StreamChunk)) (TaskResult, error) {
			mu.Lock()
			active++
			if active > maxActive {
				maxActive = active
			}
			mu.Unlock()
			time.Sleep(50 * time.Millisecond)
			mu.Lock()
			active--
			mu.Unlock()
			return TaskResult{Status: "completed", Result: "ok", FinishedAt: time.Now().Unix()}, nil
		},
		Recorder: &fakeRecorder{},
	}
	if err := h.HandleClaims(context.Background(), f.tasks); err != nil {
		t.Fatal(err)
	}
	deadline := time.After(2 * time.Second)
	for f.resultCount() < 2 {
		select {
		case <-deadline:
			t.Fatal("not all results sent")
		case <-time.After(10 * time.Millisecond):
		}
	}
	mu.Lock()
	got := maxActive
	mu.Unlock()
	if got > 1 {
		t.Fatalf("per-agent cap violated: max concurrent execs = %d", got)
	}
}

type fakeSkillFS struct {
	dirs   map[string]bool
	copies [][2]string
}

func (f *fakeSkillFS) ReadDir(string) ([]string, error) { return nil, nil }
func (f *fakeSkillFS) Copy(src, dst string) error {
	f.copies = append(f.copies, [2]string{src, dst})
	return nil
}
func (f *fakeSkillFS) MkdirAll(d string) error { f.dirs[d] = true; return nil }

func TestApplyInjectionKeepsRawRemoteAndDoesNotMaterialize(t *testing.T) {
	fs := &fakeSkillFS{dirs: map[string]bool{}}
	local := acp.Injection{
		MCPServers: []acp.MCPEntry{{Name: "fs", Command: "/local/fs"}},
		Env:        map[string]string{"LOG_LEVEL": "local"},
		CLIArgs:    []string{"--local"},
		Skills:     []acp.SkillSpec{{Source: "local", Name: "review", Path: "/local/review"}},
	}
	p := &acp.TaskPayload{
		TaskID: "t1", Instruction: "x",
		Skills:     []string{"review", "extra"},
		MCPServers: []acp.MCPEntry{{Name: "fs", Command: "/remote/fs"}, {Name: "other", Command: "/remote/other"}},
		Env:        map[string]string{"LOG_LEVEL": "remote", "REMOTE_ONLY": "1"},
		CLIArgs:    []string{"--remote"},
	}
	out, sc, mc, err := ApplyInjection(context.Background(), p, local, "/ws/t1", fs)
	if err != nil {
		t.Fatal(err)
	}
	// SEC-09: no skill materialization before the agent policy gate.
	if len(fs.copies) != 0 || len(fs.dirs) != 0 {
		t.Fatalf("skills must not be copied pre-policy: copies=%v dirs=%v", fs.copies, fs.dirs)
	}
	// Raw Multica fields preserved — local must not be folded into candidate fields.
	if out.Env["LOG_LEVEL"] != "remote" || out.Env["REMOTE_ONLY"] != "1" {
		t.Fatalf("payload env must stay remote-only: %+v", out.Env)
	}
	if len(out.CLIArgs) != 1 || out.CLIArgs[0] != "--remote" {
		t.Fatalf("payload CLI must stay remote-only: %v", out.CLIArgs)
	}
	if len(out.MCPServers) != 2 || out.MCPServers[0].Command != "/remote/fs" {
		t.Fatalf("payload MCP must stay remote-only: %+v", out.MCPServers)
	}
	if len(out.Skills) != 2 || out.Skills[0] != "review" {
		t.Fatalf("payload skills must stay raw Multica names: %v", out.Skills)
	}
	// L38 conflicts still surfaced for UI.
	if len(sc) != 1 || sc[0].Name != "review" {
		t.Fatalf("want skill conflict review: %+v", sc)
	}
	if len(mc) != 1 || mc[0].Name != "fs" {
		t.Fatalf("want mcp conflict fs: %+v", mc)
	}
}

// TestApplyInjectionSkipsTraversalSkillName is the round-3 security regression:
// a server-supplied skill name containing ".." must never participate in
// conflict path metadata (J3). The invalid name is skipped with a log; the
// task still succeeds and raw Multica skills (including the invalid name string
// as authored) remain on the payload for the agent policy gate to deny.
func TestApplyInjectionSkipsTraversalSkillName(t *testing.T) {
	fs := &fakeSkillFS{dirs: map[string]bool{}}
	local := acp.Injection{Skills: []acp.SkillSpec{{Source: "local", Name: "ok", Path: "/local/ok"}}}
	p := &acp.TaskPayload{TaskID: "t1", Instruction: "x", Skills: []string{"../evil", "ok"}}
	out, sc, mc, err := ApplyInjection(context.Background(), p, local, "/ws/t1", fs)
	if err != nil {
		t.Fatalf("invalid skill name must be skipped, not fail the task: %v", err)
	}
	if len(fs.copies) != 0 {
		t.Fatalf("no skill may be copied pre-policy, got %v", fs.copies)
	}
	if len(out.Skills) != 2 {
		t.Fatalf("raw Multica skill names preserved for agent gate: %+v", out.Skills)
	}
	// Only the valid name participates in L38 conflict detection.
	if len(sc) != 1 || sc[0].Name != "ok" {
		t.Fatalf("want conflict on ok only: %+v", sc)
	}
	_ = mc
}

func TestValidSkillNameRejectsTraversal(t *testing.T) {
	for _, name := range []string{"", ".", "..", "../evil", "a/b", `a\b`, "/abs", "..\\evil"} {
		if err := validSkillName(name); err == nil {
			t.Fatalf("expected %q to be rejected", name)
		}
	}
	for _, name := range []string{"ok", "review", "my-skill"} {
		if err := validSkillName(name); err != nil {
			t.Fatalf("expected %q to be accepted, got %v", name, err)
		}
	}
}


// --- DAEM-02 ---

type orderedAPI struct {
	recordingAPI
	ackErr   error
	timeline *[]string
}

func (o *orderedAPI) Ack(ctx context.Context, clientID, taskID string, ok bool) error {
	if o.timeline != nil {
		*o.timeline = append(*o.timeline, "ack")
	}
	if o.ackErr != nil {
		return o.ackErr
	}
	return o.recordingAPI.Ack(ctx, clientID, taskID, ok)
}

type orderedPersister struct {
	timeline  *[]string
	persisted []string
	abandoned []string
	err       error
}

func (p *orderedPersister) PersistClaim(_ context.Context, localID, _, _ string, _ []byte) error {
	if p.timeline != nil {
		*p.timeline = append(*p.timeline, "persist")
	}
	p.persisted = append(p.persisted, localID)
	return p.err
}

func (p *orderedPersister) AbandonClaim(_ context.Context, localID string) error {
	if p.timeline != nil {
		*p.timeline = append(*p.timeline, "abandon")
	}
	p.abandoned = append(p.abandoned, localID)
	return nil
}

func TestHandleClaimsPersistsBeforeAck(t *testing.T) {
	var timeline []string
	api := &orderedAPI{
		recordingAPI: recordingAPI{tasks: []ClaimedTask{{
			TaskID: "t1", MulticaTaskID: "mt1",
			Payload: []byte(`{"taskId":"t1","instruction":"go"}`),
		}}},
		timeline: &timeline,
	}
	persister := &orderedPersister{timeline: &timeline}
	q := runtime.NewQueue(1, 2)
	h := &ClaimHandler{
		API: api, Queue: q, ClientID: func() string { return "c1" },
		Claims: persister,
		Exec: func(context.Context, *acp.TaskPayload, func(runtime.StreamChunk)) (TaskResult, error) {
			return TaskResult{Status: "completed", FinishedAt: time.Now().Unix()}, nil
		},
	}
	if err := h.HandleClaims(context.Background(), api.tasks); err != nil {
		t.Fatal(err)
	}
	deadline := time.After(2 * time.Second)
	for api.resultCount() < 1 {
		select {
		case <-deadline:
			t.Fatal("no result")
		case <-time.After(5 * time.Millisecond):
		}
	}
	if len(timeline) < 2 || timeline[0] != "persist" || timeline[1] != "ack" {
		t.Fatalf("expected persist then ack, got %v", timeline)
	}
}

func TestHandleClaimsAckErrorDropsJob(t *testing.T) {
	api := &orderedAPI{
		recordingAPI: recordingAPI{tasks: []ClaimedTask{{
			TaskID: "t-drop", MulticaTaskID: "mt-drop",
			Payload: []byte(`{"taskId":"t-drop","instruction":"go"}`),
		}}},
		ackErr: errors.New("ack failed"),
	}
	persister := &orderedPersister{}
	var execCount int
	q := runtime.NewQueue(1, 2)
	h := &ClaimHandler{
		API: api, Queue: q, ClientID: func() string { return "c1" },
		Claims: persister,
		Exec: func(context.Context, *acp.TaskPayload, func(runtime.StreamChunk)) (TaskResult, error) {
			execCount++
			return TaskResult{Status: "completed", FinishedAt: time.Now().Unix()}, nil
		},
	}
	if err := h.HandleClaims(context.Background(), api.tasks); err != nil {
		t.Fatal(err)
	}
	time.Sleep(80 * time.Millisecond)
	if execCount != 0 {
		t.Fatalf("exec must not run after ack failure, got %d", execCount)
	}
	if len(persister.abandoned) != 1 || persister.abandoned[0] != "t-drop" {
		t.Fatalf("expected abandon of t-drop, got %v", persister.abandoned)
	}
	if q.Status().Queued+q.Status().ActiveTasks != 0 {
		t.Fatalf("queue must be empty after ack drop, status=%+v", q.Status())
	}
}
