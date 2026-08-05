package client

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/acp"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"
)

// AgentInvoker runs a task via `jarvis-agent run` (决策一 A)。
type AgentInvoker interface {
	RunTask(ctx context.Context, payload *acp.TaskPayload, onChunk func(runtime.StreamChunk)) (TaskResult, error)
}

// SubprocessAgentInvoker spawns jarvis-agent as a subprocess and forwards its
// JSONL stdout frames (H1.4)。端到端验证属 S6 联调;单测用 fake。
type SubprocessAgentInvoker struct {
	Bin string // 默认 "jarvis-agent"(PATH 探测,H1.1)
}

func (s *SubprocessAgentInvoker) RunTask(ctx context.Context, p *acp.TaskPayload, onChunk func(runtime.StreamChunk)) (TaskResult, error) {
	dir, err := os.MkdirTemp("", "jarvis-claim-*")
	if err != nil {
		return TaskResult{}, err
	}
	defer os.RemoveAll(dir)

	payloadPath := filepath.Join(dir, "payload.json")
	b, err := json.Marshal(p)
	if err != nil {
		return TaskResult{}, err
	}
	if err := os.WriteFile(payloadPath, b, 0o600); err != nil {
		return TaskResult{}, err
	}

	bin := s.Bin
	if bin == "" {
		bin = "jarvis-agent"
	}
	cmd := exec.CommandContext(ctx, bin, "run", "--task", payloadPath, "--local-task-id", p.TaskID)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return TaskResult{}, err
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return TaskResult{}, err
	}

	var res TaskResult
	sc := bufio.NewScanner(stdout)
	for sc.Scan() {
		var frame runtime.StreamChunk
		if err := json.Unmarshal(sc.Bytes(), &frame); err != nil {
			continue
		}
		if onChunk != nil && frame.Type == "progress" {
			onChunk(frame)
		}
		if frame.Type == "result" {
			res = TaskResult{Status: frame.Status, Result: frame.Result, Error: frame.Error, Model: frame.Model, FinishedAt: frame.TS}
		}
	}
	if err := cmd.Wait(); err != nil {
		return TaskResult{}, err
	}
	if res.Status == "" {
		res = TaskResult{Status: "failed", Error: "agent produced no result frame"}
	}
	return res, nil
}
