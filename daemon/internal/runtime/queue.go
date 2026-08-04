package runtime

import (
	"sync"
)

// Job is a unit of work submitted to the daemon's in-memory queue.
// AgentID is used to enforce the per-agent concurrency cap.
type Job struct {
	AgentID string
	Run     func()
}

// Queue is a bounded in-memory task queue. It enforces two caps
// simultaneously: at most `machine` jobs run at once, and at most
// `perAgent` jobs run concurrently for any single agent.
type Queue struct {
	mu           sync.Mutex
	perAgent     int
	machine      int
	active       map[string]int // active per-agent counter (read/written)
	runningTotal int
	waiting      []Job
}

// NewQueue creates a Queue with per-agent and machine-wide concurrency caps.
func NewQueue(perAgent, machine int) *Queue {
	return &Queue{perAgent: perAgent, machine: machine, active: map[string]int{}}
}

// Status is a point-in-time snapshot of the queue for the /status endpoint.
type Status struct {
	ActiveTasks int // jobs currently running
	Queued      int // jobs waiting to start
	PerAgent    int // configured per-agent cap
	Concurrency int // configured machine-wide cap
}

// Submit appends a job for the given agent and kicks the pump so it can be
// started as soon as both the per-agent and machine caps allow.
func (q *Queue) Submit(agentId string, run func()) {
	q.mu.Lock()
	q.waiting = append(q.waiting, Job{AgentID: agentId, Run: run})
	q.mu.Unlock()
	q.pump()
}

// Status returns a snapshot of the queue state.
func (q *Queue) Status() Status {
	q.mu.Lock()
	defer q.mu.Unlock()
	return Status{
		ActiveTasks: q.runningTotal,
		Queued:      len(q.waiting),
		PerAgent:    q.perAgent,
		Concurrency: q.machine,
	}
}

// pump starts as many waiting jobs as the caps allow. It selects the first
// waiting job whose agent still has capacity AND the machine-wide running
// total is under the cap, increments both counters, then runs it in a
// goroutine that decrements on completion and re-pumps to fill the slot.
func (q *Queue) pump() {
	for {
		q.mu.Lock()
		idx := -1
		for i := range q.waiting {
			j := q.waiting[i]
			if q.active[j.AgentID] < q.perAgent && q.runningTotal < q.machine {
				idx = i
				break
			}
		}
		if idx == -1 {
			q.mu.Unlock()
			return
		}
		job := q.waiting[idx]
		q.waiting = append(q.waiting[:idx], q.waiting[idx+1:]...)
		q.active[job.AgentID]++
		q.runningTotal++
		q.mu.Unlock()

		go func(j Job) {
			defer func() {
				q.mu.Lock()
				q.active[j.AgentID]--
				q.runningTotal--
				q.mu.Unlock()
				q.pump()
			}()
			j.Run()
		}(job)
	}
}
