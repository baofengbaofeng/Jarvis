package main

import (
	"context"
	"log"
	"os"
	"path/filepath"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/db"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/acp"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/policy"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"
)

// emptyInjectionSource is an explicit stub until the lifecycle plan wires the
// real local InjectionStore snapshot (MCP/skills/env per agent).
type emptyInjectionSource struct{}

func (emptyInjectionSource) ForAgent(context.Context, string) (acp.Injection, error) {
	return acp.Injection{Env: map[string]string{}}, nil
}

func main() {
	out := os.Stdout
	root := NewRootCmd(out)
	root.Version = cliVersion
	root.AddCommand(NewVersionCmd(staticVersion(cliVersion), out))
	root.AddCommand(NewHealthCmd(&defaultHealth{cliVersion: cliVersion}, out))

	if d, err := db.Open(defaultDBPath()); err != nil {
		log.Printf("warn: open db %s: %v", defaultDBPath(), err)
	} else {
		defer d.Close()
		approvalsPath, pendingPath := policy.DefaultInjectionPaths()
		approvals := policy.NewFileApprovalStore(approvalsPath)
		pending := policy.NewFilePendingStore(pendingPath)
		evaluator := policy.NewEvaluator(policy.LoadPolicyConfigFromEnv(), approvals)
		root.AddCommand(NewListModelsCmd(sqliteModelLister{d: d}, out))
		root.AddCommand(NewRunCmd(RunDeps{
			Runner:           &NodeRunner{},
			History:          &sqliteHistoryLoader{d: d},
			Recorder:         &sqliteTaskRecorder{d: d},
			Pool:             runtime.NewWorkspacePool(workspaceRoot()),
			Profiles:         &sqliteProfileStore{d: d},
			InjectionPolicy:  evaluator,
			InjectionAudit:   policy.NewJSONLAudit(os.Stderr),
			InjectionPending: pending,
			// Explicit empty local snapshot; real per-agent MCP/skills arrive via
			// the task/daemon lifecycle InjectionStore plan.
			InjectionSource: emptyInjectionSource{},
		}, out))
	}

	if err := root.Execute(); err != nil {
		os.Exit(1)
	}
}

func workspaceRoot() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(".", ".jarvis", "workspaces")
	}
	return filepath.Join(home, ".jarvis", "workspaces")
}

func defaultDBPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(".", ".jarvis", "jarvis.db")
	}
	return filepath.Join(home, ".jarvis", "jarvis.db")
}
