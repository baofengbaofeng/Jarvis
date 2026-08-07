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
	c := NewClient(api, ClientOptions{Name: "mac", Version: "1.0.0-Preview", Concurrency: 6})
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
