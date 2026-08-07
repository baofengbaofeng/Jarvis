package client

import (
	"context"
	"log"
	"time"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/acp"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"
)

// ExecFunc runs one parsed task; onChunk forwards stream frames (H1.4).
type ExecFunc func(ctx context.Context, payload *acp.TaskPayload, onChunk func(runtime.StreamChunk)) (TaskResult, error)

// TaskRecorder persists the local<->multica id mapping (L36).
type TaskRecorder interface {
	Record(ctx context.Context, localTaskID, multicaTaskID string) error
}

// ClaimPersister durable-stores a claimed task before Multica Ack (DAEM-02).
// PersistClaim must succeed before Ack(true); on Ack failure AbandonClaim drops
// the row so a restart does not resurrect an unacked job.
type ClaimPersister interface {
	PersistClaim(ctx context.Context, localID, multicaID, agentID string, payload []byte) error
	AbandonClaim(ctx context.Context, localID string) error
}

// ClaimHandler turns claimed tasks into queued local jobs and streams results back
// (H1.10/H1.11/H1.13/H1.4/L36/L38)。
type ClaimHandler struct {
	API       ClientAPI
	Queue     *runtime.Queue
	ClientID  func() string
	AgentID   string // queue per-agent slot; defaults to "jarvis" (matches the advertised concurrency)
	Exec      ExecFunc
	Recorder  TaskRecorder
	Claims    ClaimPersister
	Conflicts *ConflictStore
}

// HandleClaims parses each claimed task, persists, acks, and submits to the Queue
// with lifecycle queued→running→completed/failed (H1.13) and concurrency (H1.11).
// DAEM-02: persist before Ack; Ack error abandons the claim and does not submit.
// All tasks share one agent slot so the per-agent cap (JARVIS_CONCURRENCY_PER_AGENT)
// binds across tasks and matches the concurrency advertised to the Multica server.
func (h *ClaimHandler) HandleClaims(ctx context.Context, tasks []ClaimedTask) error {
	agentID := h.AgentID
	if agentID == "" {
		agentID = "jarvis"
	}
	for _, tk := range tasks {
		payload, err := acp.ParseTaskPayload(tk.Payload)
		if err != nil {
			_ = h.API.Ack(ctx, h.ClientID(), tk.TaskID, false)
			continue
		}
		localID := tk.TaskID
		if h.Claims != nil {
			if err := h.Claims.PersistClaim(ctx, localID, tk.MulticaTaskID, agentID, tk.Payload); err != nil {
				log.Printf("multica persist claim %s: %v", localID, err)
				_ = h.API.Ack(ctx, h.ClientID(), tk.TaskID, false)
				continue
			}
		}
		if err := h.API.Ack(ctx, h.ClientID(), tk.TaskID, true); err != nil {
			log.Printf("multica ack %s: %v — dropping job", localID, err)
			if h.Claims != nil {
				if aerr := h.Claims.AbandonClaim(ctx, localID); aerr != nil {
					log.Printf("multica abandon claim %s: %v", localID, aerr)
				}
			}
			continue
		}
		h.Queue.Submit(agentID, func() {
			if err := h.runOne(ctx, payload, localID, tk.MulticaTaskID); err != nil {
				log.Printf("multica runOne %s: %v", localID, err)
			}
		})
	}
	return nil
}

// HandleClaimsRecovered re-queues durable claims after a daemon restart
// (DAEM-02). These tasks were already Ack'd to Multica before the crash, so
// we skip Persist/Ack and only Submit.
func (h *ClaimHandler) HandleClaimsRecovered(ctx context.Context, tasks []ClaimedTask) {
	agentID := h.AgentID
	if agentID == "" {
		agentID = "jarvis"
	}
	for _, tk := range tasks {
		payload, err := acp.ParseTaskPayload(tk.Payload)
		if err != nil {
			log.Printf("multica recover skip bad payload %s: %v", tk.TaskID, err)
			continue
		}
		localID := tk.TaskID
		multicaID := tk.MulticaTaskID
		h.Queue.Submit(agentID, func() {
			if err := h.runOne(ctx, payload, localID, multicaID); err != nil {
				log.Printf("multica recover runOne %s: %v", localID, err)
			}
		})
	}
}

func (h *ClaimHandler) runOne(ctx context.Context, payload *acp.TaskPayload, localID, multicaID string) error {
	onChunk := func(ch runtime.StreamChunk) {
		_ = h.API.StreamProgress(ctx, h.ClientID(), payload.TaskID, ch)
	}
	onChunk(runtime.StreamChunk{Type: "progress", TaskID: payload.TaskID, Status: "running", TS: time.Now().Unix()})

	res, err := h.Exec(ctx, payload, onChunk)
	if err != nil {
		res = TaskResult{Status: "failed", Error: err.Error(), FinishedAt: time.Now().Unix()}
	}
	// DAEM-03: SendResult must outlive the Multica Serve/signal ctx so a
	// shutdown cancel cannot drop the final result report.
	sendCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := h.API.SendResult(sendCtx, h.ClientID(), payload.TaskID, res); err != nil {
		return err
	}
	if h.Recorder != nil {
		_ = h.Recorder.Record(ctx, localID, multicaID)
	}
	return nil
}
