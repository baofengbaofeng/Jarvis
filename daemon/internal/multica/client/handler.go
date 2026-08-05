package client

import (
	"context"
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

// ClaimHandler turns claimed tasks into queued local jobs and streams results back
// (H1.10/H1.11/H1.13/H1.4/L36/L38)。
type ClaimHandler struct {
	API       ClientAPI
	Queue     *runtime.Queue
	ClientID  func() string
	Exec      ExecFunc
	Recorder  TaskRecorder
	Conflicts *ConflictStore
}

// HandleClaims parses each claimed task, acks, and submits to the Queue with
// lifecycle queued→running→completed/failed (H1.13) and concurrency (H1.11).
// The task's local ID is used as the per-agent slot so the queue's machine-wide
// cap (and per-agent cap, when several tasks share an agent) are both enforced.
func (h *ClaimHandler) HandleClaims(ctx context.Context, tasks []ClaimedTask) error {
	for _, tk := range tasks {
		payload, err := acp.ParseTaskPayload(tk.Payload)
		if err != nil {
			_ = h.API.Ack(ctx, h.ClientID(), tk.TaskID, false)
			continue
		}
		_ = h.API.Ack(ctx, h.ClientID(), tk.TaskID, true)
		localID := tk.TaskID
		h.Queue.Submit(localID, func() {
			_ = h.runOne(ctx, payload, localID, tk.MulticaTaskID)
		})
	}
	return nil
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
	if err := h.API.SendResult(ctx, h.ClientID(), payload.TaskID, res); err != nil {
		return err
	}
	if h.Recorder != nil {
		_ = h.Recorder.Record(ctx, localID, multicaID)
	}
	return nil
}
