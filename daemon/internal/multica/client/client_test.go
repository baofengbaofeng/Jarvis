package client

import (
	"context"
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

var _ = time.Second
