package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/policy"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"
)

func injectionServer(t *testing.T) (*Server, *policy.PendingStore, *policy.FileApprovalStore) {
	t.Helper()
	pending := policy.NewPendingStore()
	approvals := policy.NewFileApprovalStore(filepath.Join(t.TempDir(), "approvals.json"))
	svc := &InjectionApprovalService{Pending: pending, Approvals: approvals}
	s := NewServerWithAuth("1.0.0-Preview", runtime.NewQueue(1, 1), "secret", svc)
	return s, pending, approvals
}

func injRequest(s *Server, method, path, body string, auth bool) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	if auth {
		req.Header.Set("Authorization", "Bearer secret")
	}
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	return rec
}

func TestInjectionApprovalsRequireAuth(t *testing.T) {
	s, _, _ := injectionServer(t)
	rec := injRequest(s, http.MethodGet, "/v1/runtime/injection-approvals", "", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("got %d", rec.Code)
	}
}

func TestInjectionApprovalsListAndApprove(t *testing.T) {
	s, pending, approvals := injectionServer(t)
	digest := strings.Repeat("a", 64)
	pending.Put(policy.PendingApproval{Kind: "mcp", Name: "fs", Digest: digest, TaskID: "t1"})

	list := injRequest(s, http.MethodGet, "/v1/runtime/injection-approvals", "", true)
	if list.Code != http.StatusOK {
		t.Fatalf("list %d", list.Code)
	}
	var items []policy.PendingApproval
	if err := json.Unmarshal(list.Body.Bytes(), &items); err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Name != "fs" || items[0].Digest != digest {
		t.Fatalf("items=%#v", items)
	}
	if strings.Contains(list.Body.String(), "super-secret") || strings.Contains(list.Body.String(), "--password") {
		t.Fatalf("sensitive material leaked: %s", list.Body.String())
	}

	rec := injRequest(s, http.MethodPost, "/v1/runtime/injection-approvals/"+digest, `{"kind":"mcp","name":"fs"}`, true)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("approve got %d body=%s", rec.Code, rec.Body.String())
	}
	if len(pending.List()) != 0 {
		t.Fatal("pending should be cleared")
	}
	ok, err := approvals.IsApproved(t.Context(), policy.ApprovalKey{Kind: "mcp", Name: "fs", Digest: digest})
	if err != nil || !ok {
		t.Fatalf("approved=%v err=%v", ok, err)
	}
}

func TestInjectionApproveRejectsDigestReplacement(t *testing.T) {
	s, pending, _ := injectionServer(t)
	digest := strings.Repeat("b", 64)
	pending.Put(policy.PendingApproval{Kind: "mcp", Name: "fs", Digest: digest, TaskID: "t1"})

	rec := injRequest(s, http.MethodPost, "/v1/runtime/injection-approvals/"+digest, `{"kind":"mcp","name":"evil"}`, true)
	if rec.Code != http.StatusConflict {
		t.Fatalf("got %d want 409", rec.Code)
	}
	if len(pending.List()) != 1 {
		t.Fatal("pending must remain on conflict")
	}
}

func TestInjectionApproveUnknownDigest(t *testing.T) {
	s, _, _ := injectionServer(t)
	rec := injRequest(s, http.MethodPost, "/v1/runtime/injection-approvals/"+strings.Repeat("c", 64), `{"kind":"mcp","name":"fs"}`, true)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("got %d", rec.Code)
	}
}

func TestInjectionApproveDoesNotAutoExecute(t *testing.T) {
	// Contract: POST only persists approval; no task runner is invoked.
	s, pending, _ := injectionServer(t)
	digest := strings.Repeat("d", 64)
	pending.Put(policy.PendingApproval{Kind: "mcp", Name: "fs", Digest: digest, TaskID: "old-task"})
	rec := injRequest(s, http.MethodPost, "/v1/runtime/injection-approvals/"+digest, `{"kind":"mcp","name":"fs"}`, true)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("got %d", rec.Code)
	}
	// No side channel exists to auto-run; asserting 204 + empty pending is the gate.
	if len(pending.List()) != 0 {
		t.Fatal("expected empty pending after approve")
	}
}
