package client

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"
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

func (f *fakeAPI) StreamProgress(_ context.Context, _, _ string, _ runtime.StreamChunk) error {
	return nil
}
func (f *fakeAPI) SendResult(_ context.Context, _, _ string, _ TaskResult) error { return nil }
func (f *fakeAPI) Ack(_ context.Context, _, _ string, _ bool) error              { return nil }

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

// TestRegisteredIDReturnsServerAssigned is the I3 regression: after Register, the
// server-assigned client id must be exposed (not the literal name), thread-safe
// across concurrent readers.
func TestRegisteredIDReturnsServerAssigned(t *testing.T) {
	f := &fakeAPI{}
	c := NewClient(f, ClientOptions{Name: "jarvis", Version: "0.1.0"})
	if got := c.RegisteredID(); got != "" {
		t.Fatalf("expected empty before register, got %q", got)
	}
	if _, err := c.Register(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := c.RegisteredID(); got != "client-1" {
		t.Fatalf("expected server-assigned client-1, got %q", got)
	}
	// Concurrent reads must be race-free (Serve re-registers on another goroutine).
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				if c.RegisteredID() != "client-1" {
					t.Error("unexpected RegisteredID")
				}
			}
		}()
	}
	wg.Wait()
}

// flakyAPI fails a fixed number of heartbeats, then succeeds, and counts
// register calls — used to prove Serve re-registers after an error (I1).
type flakyAPI struct {
	mu             sync.Mutex
	registers      int
	failHeartbeats int
}

func (f *flakyAPI) Register(_ context.Context, _ RegisterRequest) (RegisterResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.registers++
	return RegisterResponse{ClientID: "client-1", HeartbeatSec: 15, PollSec: 3}, nil
}

func (f *flakyAPI) Heartbeat(_ context.Context, _ string, _ HeartbeatStatus) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.failHeartbeats > 0 {
		f.failHeartbeats--
		return errors.New("heartbeat failed")
	}
	return nil
}

func (f *flakyAPI) Poll(_ context.Context, _ string) ([]ClaimedTask, error) { return nil, nil }
func (f *flakyAPI) StreamProgress(context.Context, string, string, runtime.StreamChunk) error {
	return nil
}
func (f *flakyAPI) SendResult(context.Context, string, string, TaskResult) error { return nil }
func (f *flakyAPI) Ack(context.Context, string, string, bool) error              { return nil }

func (f *flakyAPI) registerCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.registers
}

// TestServeReRegistersAfterError is the I1 regression: a single heartbeat failure
// must not kill the Serve goroutine permanently — it re-registers and keeps going.
func TestServeReRegistersAfterError(t *testing.T) {
	f := &flakyAPI{failHeartbeats: 1}
	c := NewClient(f, ClientOptions{
		HeartbeatSec: 5 * time.Millisecond,
		PollSec:      100 * time.Millisecond,
		ReconnectSec: 5 * time.Millisecond,
	})
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if err := c.Serve(ctx, func() HeartbeatStatus { return HeartbeatStatus{Status: "idle"} }, nil); err != nil {
		t.Fatal(err)
	}
	if got := f.registerCount(); got < 2 {
		t.Fatalf("expected re-register after heartbeat failure, got %d registers", got)
	}
}

var _ = time.Second
