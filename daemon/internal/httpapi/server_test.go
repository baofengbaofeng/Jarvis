package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"
)

func TestHealth(t *testing.T) {
	srv := NewServer("1.0.0-Preview", runtime.NewQueue(6, 20))
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
	srv := NewServer("1.0.0-Preview", runtime.NewQueue(6, 20))
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
	if body["version"] != "1.0.0-Preview" {
		t.Fatalf("expected version 1.0.0-Preview, got %v", body["version"])
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

func TestNewHTTPServerSetsTimeouts(t *testing.T) {
	srv := NewHTTPServer("127.0.0.1:0", NewServer("1.0.0-Preview", runtime.NewQueue(1, 1)).Handler())
	if srv.ReadHeaderTimeout <= 0 {
		t.Fatal("ReadHeaderTimeout must be set")
	}
	if srv.ReadTimeout <= 0 {
		t.Fatal("ReadTimeout must be set")
	}
	if srv.WriteTimeout <= 0 {
		t.Fatal("WriteTimeout must be set")
	}
	if srv.IdleTimeout <= 0 {
		t.Fatal("IdleTimeout must be set")
	}
}
