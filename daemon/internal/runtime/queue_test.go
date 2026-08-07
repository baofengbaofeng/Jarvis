package runtime

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestQueueRunsJobs(t *testing.T) {
	q := NewQueue(1, 2)
	var mu sync.Mutex
	var ran []string
	done := make(chan struct{}, 3)
	for i := 0; i < 3; i++ {
		id := string(rune('a' + i))
		q.Submit(id, func() {
			mu.Lock()
			ran = append(ran, id)
			mu.Unlock()
			done <- struct{}{}
		})
	}
	for i := 0; i < 3; i++ {
		<-done
	}
	mu.Lock()
	defer mu.Unlock()
	if len(ran) != 3 {
		t.Fatalf("expected 3 jobs, got %d", len(ran))
	}
}

func TestQueueRecoversPanickingJobAndContinues(t *testing.T) {
	q := NewQueue(2, 2)
	done := make(chan struct{}, 2)
	q.Submit("a", func() {
		defer func() { done <- struct{}{} }()
		panic("boom")
	})
	q.Submit("b", func() {
		done <- struct{}{}
	})
	for i := 0; i < 2; i++ {
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for jobs")
		}
	}
	st := q.Status()
	if st.ActiveTasks != 0 {
		t.Fatalf("expected no active tasks after panic recovery, got %d", st.ActiveTasks)
	}
}

func TestQueueRespectsPerAgentCap(t *testing.T) {
	q := NewQueue(2, 10)
	var active, peak int
	var mu sync.Mutex
	done := make(chan struct{}, 5)
	for i := 0; i < 5; i++ {
		q.Submit("agent", func() {
			mu.Lock()
			active++
			if active > peak {
				peak = active
			}
			mu.Unlock()
			time.Sleep(10 * time.Millisecond)
			mu.Lock()
			active--
			mu.Unlock()
			done <- struct{}{}
		})
	}
	for i := 0; i < 5; i++ {
		<-done
	}
	mu.Lock()
	defer mu.Unlock()
	if peak > 2 {
		t.Fatalf("peak %d exceeds per-agent cap 2", peak)
	}
}

func TestQueueDrainWaitsForInFlight(t *testing.T) {
	q := NewQueue(1, 1)
	started := make(chan struct{})
	q.Submit("a", func() {
		close(started)
		time.Sleep(50 * time.Millisecond)
	})
	<-started
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := q.Drain(ctx); err != nil {
		t.Fatal(err)
	}
	if q.Status().ActiveTasks != 0 || q.Status().Queued != 0 {
		t.Fatalf("expected empty queue after drain, got %+v", q.Status())
	}
}
