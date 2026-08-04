package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"
)

func TestHealth(t *testing.T) {
	srv := NewServer("0.1.0", runtime.NewQueue(6, 20))
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	srv.mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["ok"] != true {
		t.Fatalf("expected ok=true, got %v", body["ok"])
	}
}

func TestStatus(t *testing.T) {
	srv := NewServer("0.1.0", runtime.NewQueue(6, 20))
	req := httptest.NewRequest(http.MethodGet, "/status", nil)
	rec := httptest.NewRecorder()
	srv.mux.ServeHTTP(rec, req)
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["running"] != true {
		t.Fatalf("expected running=true, got %v", body["running"])
	}
	if body["version"] != "0.1.0" {
		t.Fatalf("expected version 0.1.0, got %v", body["version"])
	}
	if body["activeTasks"] != float64(0) {
		t.Fatalf("expected activeTasks=0, got %v", body["activeTasks"])
	}
	if body["queued"] != float64(0) {
		t.Fatalf("expected queued=0, got %v", body["queued"])
	}
	if body["perAgent"] != float64(6) {
		t.Fatalf("expected perAgent=6, got %v", body["perAgent"])
	}
	if body["concurrency"] != float64(20) {
		t.Fatalf("expected concurrency=20, got %v", body["concurrency"])
	}
}
