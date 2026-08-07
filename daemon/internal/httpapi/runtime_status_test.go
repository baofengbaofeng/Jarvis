package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/acp"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"
)

// fakeRuntime implements httpapi.RuntimeInfo (L39 数据面) for the endpoint test.
type fakeRuntime struct {
	registered bool
	busy       bool
	active     int
	heartbeat  int64
	serverURL  string
}

func (f fakeRuntime) Registered() bool       { return f.registered }
func (f fakeRuntime) Busy() bool             { return f.busy }
func (f fakeRuntime) ActiveTasks() int       { return f.active }
func (f fakeRuntime) LastHeartbeatAt() int64 { return f.heartbeat }
func (f fakeRuntime) ServerURL() string      { return f.serverURL }
func (f fakeRuntime) CLIProtocol() string    { return "acp" }

// fakeConflicts implements httpapi.ConflictSource (L38 数据面). It mirrors the
// client.ConflictStore shape but returns the httpapi-local ConflictItem so the
// endpoint test stays in this package (httpapi must not import the client pkg).
type fakeConflicts struct{ items []ConflictItem }

func (f fakeConflicts) Conflicts() []ConflictItem { return f.items }

func TestRuntimeStatusEndpoint(t *testing.T) {
	q := runtime.NewQueue(6, 20)
	srv := NewServer("1.0.0-Preview", q, fakeRuntime{registered: true, busy: false, serverURL: "https://multica.example"})
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
	cs := fakeConflicts{items: []ConflictItem{{TaskID: "t1", Skill: &acp.SkillConflict{Name: "review", LocalPath: "/l", MulticaPath: "/m"}}}}
	srv := NewServer("1.0.0-Preview", q, cs)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/runtime/conflicts", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	var out []ConflictItem
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out) != 1 || out[0].Skill == nil || out[0].Skill.Name != "review" {
		t.Fatalf("unexpected conflicts: %+v", out)
	}
}
