package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/db"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/acp"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"
	"github.com/spf13/cobra"
)

// RunSpec is the merged per-task execution spec handed to the core REACT loop.
type RunSpec struct {
	Agent           string               `json:"agent,omitempty"`
	Model           string               `json:"model,omitempty"`
	Profile         string               `json:"profile,omitempty"`
	Workspace       string               `json:"workspace"`
	InitialMessages []acp.InitialMessage `json:"initialMessages"`
	Injection       acp.Injection        `json:"injection"`
	Env             map[string]string    `json:"env,omitempty"`
}

// RunResult is the final outcome of a task execution.
type RunResult struct {
	Result string `json:"result"`
	Model  string `json:"model,omitempty"`
	Status string `json:"status"` // completed | failed
	Error  string `json:"error,omitempty"`
}

// Runner executes the REACT loop. 真实实现 NodeRunner 内嵌 Node headless 跑 core(决策一 A);
// 单测使用 fake(端到端属 S6 联调)。
type Runner interface {
	Run(ctx context.Context, spec RunSpec) (RunResult, error)
}

// HistoryLoader loads a prior conversation by uuid (H1.5 --conversation).
type HistoryLoader interface {
	Load(ctx context.Context, conversationID string) ([]acp.InitialMessage, error)
}

// TaskRecorder persists the local<->multica task id mapping (L36).
type TaskRecorder interface {
	Record(ctx context.Context, localTaskID, multicaTaskID string) error
}

// ProfileStore loads a runtime profile by id (H1.14).
type ProfileStore interface {
	Get(ctx context.Context, id string) (*db.Profile, error)
}

// RunDeps are the injected dependencies of the `run` command.
type RunDeps struct {
	Runner   Runner
	History  HistoryLoader
	Recorder TaskRecorder
	Pool     *runtime.WorkspacePool
	Profiles ProfileStore
}

// TaskOpts are the command-level options for one execution.
type TaskOpts struct {
	LocalTaskID string
}

// ExecuteTask orchestrates one ACP task: history (H1.5) -> profile (H1.14) ->
// injection merge (H1.6-H1.8) -> workspace (H1.12) -> REACT loop -> stream (H1.4)
// -> id mapping (L36)。
func ExecuteTask(ctx context.Context, deps RunDeps, payload *acp.TaskPayload, opts TaskOpts, stream *runtime.StreamWriter) error {
	msgs := acp.BuildInitialMessages(payload)

	if payload.Conversation != nil && *payload.Conversation != "" {
		hist, err := deps.History.Load(ctx, *payload.Conversation)
		if err != nil {
			return fmt.Errorf("load conversation %s: %w", *payload.Conversation, err)
		}
		msgs = append(hist, msgs...)
	}

	env := map[string]string{}
	if payload.Profile != "" {
		prof, err := deps.Profiles.Get(ctx, payload.Profile)
		if err != nil {
			return fmt.Errorf("load profile %s: %w", payload.Profile, err)
		}
		if prof != nil {
			for k, v := range prof.Env {
				if _, ok := env[k]; !ok {
					env[k] = v
				}
			}
		}
	}
	for k, v := range payload.Env {
		if _, ok := env[k]; !ok {
			env[k] = v
		}
	}

	local := acp.Injection{Env: env}
	merged, _, _ := acp.MergeInjections(local, acp.Injection{
		MCPServers: payload.MCPServers,
		Env:        payload.Env,
		CLIArgs:    payload.CLIArgs,
	})

	ws, err := deps.Pool.Allocate(payload.TaskID)
	if err != nil {
		return fmt.Errorf("allocate workspace: %w", err)
	}
	defer func() { _ = deps.Pool.Cleanup(payload.TaskID) }()

	spec := RunSpec{
		Agent:           payload.Agent,
		Profile:         payload.Profile,
		Workspace:       ws,
		InitialMessages: msgs,
		Injection:       merged,
		Env:             merged.Env,
	}

	_ = stream.Progress(payload.TaskID, "running", "")
	res, err := deps.Runner.Run(ctx, spec)
	if err != nil {
		_ = stream.Result(payload.TaskID, "failed", "", "", err.Error())
		return err
	}
	_ = stream.Result(payload.TaskID, res.Status, res.Result, res.Model, res.Error)

	if deps.Recorder != nil && opts.LocalTaskID != "" && payload.MulticaTaskID != "" {
		if err := deps.Recorder.Record(ctx, opts.LocalTaskID, payload.MulticaTaskID); err != nil {
			return fmt.Errorf("record id mapping: %w", err)
		}
	}
	return nil
}

// NodeRunner spawns the embedded Node headless process running packages/core
// (决策一 A)。spec 写临时文件;core 读 spec、执行 REACT loop,stdout 输出
// JSONL {"type":"delta"|"result",...}。端到端验证属 S6 联调。
type NodeRunner struct {
	NodeBin   string // 默认 "node"
	CoreEntry string // 默认 env JARVIS_CORE_ENTRY
	ExtraEnv  []string
}

func (r *NodeRunner) Run(ctx context.Context, spec RunSpec) (RunResult, error) {
	dir, err := os.MkdirTemp("", "jarvis-agent-*")
	if err != nil {
		return RunResult{}, err
	}
	defer os.RemoveAll(dir)

	specPath := filepath.Join(dir, "spec.json")
	b, err := json.Marshal(spec)
	if err != nil {
		return RunResult{}, err
	}
	if err := os.WriteFile(specPath, b, 0o600); err != nil {
		return RunResult{}, err
	}

	cmd := exec.CommandContext(ctx, r.node(), r.coreEntry(), "--spec", specPath)
	cmd.Env = append(os.Environ(), r.ExtraEnv...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return RunResult{}, err
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return RunResult{}, err
	}

	// parseResultFrames reads stdout to EOF BEFORE cmd.Wait(): a partial read
	// could leave the child blocked writing to a full pipe and deadlock Wait.
	res, perr := parseResultFrames(stdout)
	if perr != nil {
		_ = cmd.Wait() // reap the child even on a read error
		return RunResult{}, perr
	}
	if err := cmd.Wait(); err != nil {
		return RunResult{}, err
	}
	return res, nil
}

// resultFrame is one JSONL line emitted by the core on stdout.
type resultFrame struct {
	Type   string `json:"type"`
	Status string `json:"status"`
	Result string `json:"result,omitempty"`
	Error  string `json:"error,omitempty"`
	Model  string `json:"model,omitempty"`
}

// parseResultFrames reads a JSONL stream ({"type":"delta"|"result",...}) and
// returns the LAST "result" frame (later frames win), or a failed RunResult if
// none was seen. Unlike a bufio.Scanner (64KB token cap), bufio.Reader lines
// are unbounded, so a large frame cannot truncate mid-frame; the stream is
// always drained to EOF/error, and non-JSON noise lines are skipped.
func parseResultFrames(r io.Reader) (RunResult, error) {
	var res RunResult
	br := bufio.NewReader(r)
	for {
		line, err := br.ReadBytes('\n')
		if len(line) > 0 {
			line = bytes.TrimSpace(line)
			if len(line) > 0 {
				var f resultFrame
				if uerr := json.Unmarshal(line, &f); uerr == nil && f.Type == "result" {
					res = RunResult{Result: f.Result, Model: f.Model, Status: f.Status, Error: f.Error}
				}
			}
		}
		if err != nil {
			if err == io.EOF {
				break
			}
			return res, err
		}
	}
	if res.Status == "" {
		res.Status = "failed"
		res.Error = "core produced no result frame"
	}
	return res, nil
}

func (r *NodeRunner) node() string {
	if r.NodeBin != "" {
		return r.NodeBin
	}
	return "node"
}

func (r *NodeRunner) coreEntry() string {
	if r.CoreEntry != "" {
		return r.CoreEntry
	}
	if v := os.Getenv("JARVIS_CORE_ENTRY"); v != "" {
		return v
	}
	return "packages/core/dist/headless.mjs"
}

func NewRunCmd(deps RunDeps, out io.Writer) *cobra.Command {
	var payloadFile string
	var localTaskID string
	cmd := &cobra.Command{
		Use:   "run",
		Short: "Execute one ACP task (JSON payload) via the core REACT loop",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			var data []byte
			var err error
			if payloadFile != "" {
				data, err = os.ReadFile(payloadFile)
			} else {
				data, err = io.ReadAll(cmd.InOrStdin())
			}
			if err != nil {
				return err
			}
			payload, err := acp.ParseTaskPayload(data)
			if err != nil {
				return err
			}
			return ExecuteTask(cmd.Context(), deps, payload, TaskOpts{LocalTaskID: localTaskID}, runtime.NewStreamWriter(out))
		},
	}
	cmd.Flags().StringVar(&payloadFile, "task", "", "path to task payload JSON (default: stdin)")
	cmd.Flags().StringVar(&localTaskID, "local-task-id", "", "local task id to record the multica mapping (L36)")
	return cmd
}
