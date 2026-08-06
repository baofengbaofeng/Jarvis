package client

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/acp"
)

// SkillFS abstracts skill copy filesystem ops (H1.7).
type SkillFS interface {
	ReadDir(dir string) ([]string, error)
	Copy(src, dst string) error
	MkdirAll(dir string) error
}

// DefaultSkillFS returns a SkillFS backed by the real filesystem (H1.7, C2).
func DefaultSkillFS() SkillFS { return defaultSkillFS{} }

type defaultSkillFS struct{}

func (defaultSkillFS) ReadDir(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names, nil
}

func (defaultSkillFS) Copy(src, dst string) error { return copyPath(src, dst) }

func (defaultSkillFS) MkdirAll(dir string) error { return os.MkdirAll(dir, 0o755) }

// copyPath copies src to dst, recursively for directories. Skills in the Multica
// payload are directory names, so the default fs must handle both files and dirs.
func copyPath(src, dst string) error {
	info, err := os.Stat(src)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		data, err := os.ReadFile(src)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return err
		}
		return os.WriteFile(dst, data, info.Mode().Perm())
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}
	for _, e := range entries {
		if err := copyPath(filepath.Join(src, e.Name()), filepath.Join(dst, e.Name())); err != nil {
			return err
		}
	}
	return nil
}

// ApplyInjection computes L38 name conflicts between local and Multica injections
// but does NOT merge remote into the payload or materialize skills (SEC-09).
// The returned payload keeps Multica MCP/Env/CLI/Skills fields raw so
// jarvis-agent CandidateFromPayload + policy.Evaluate remain remote-only;
// skill copy / MergeInjections happen only after the agent policy gate.
func ApplyInjection(ctx context.Context, p *acp.TaskPayload, local acp.Injection, workspace string, fs SkillFS) (*acp.TaskPayload, []acp.SkillConflict, []acp.MCPConflict, error) {
	_ = ctx
	_ = workspace
	_ = fs

	remote := acp.Injection{
		MCPServers: append([]acp.MCPEntry{}, p.MCPServers...),
		Env:        cloneEnv(p.Env),
		CLIArgs:    append([]string{}, p.CLIArgs...),
	}
	for _, name := range p.Skills {
		if err := validSkillName(name); err != nil {
			log.Printf("multica: skipping invalid skill name %q: %v", name, err)
			continue
		}
		remote.Skills = append(remote.Skills, acp.SkillSpec{Source: "multica", Name: name})
	}
	_, sc, mc := acp.MergeInjections(local, remote)

	// Preserve Multica-authored fields exactly — never fold local MCP/env/CLI
	// into payload fields that CandidateFromPayload treats as remote.
	out := *p
	out.MCPServers = append([]acp.MCPEntry{}, p.MCPServers...)
	out.Env = cloneEnv(p.Env)
	out.CLIArgs = append([]string{}, p.CLIArgs...)
	out.Skills = append([]string{}, p.Skills...)
	return &out, sc, mc, nil
}

func cloneEnv(in map[string]string) map[string]string {
	if in == nil {
		return nil
	}
	out := make(map[string]string, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

// validSkillName rejects server-supplied skill names that could escape the task
// workspace (J3) — the same discipline WorkspacePool.validTaskID applies to task
// ids: empty, path separators, ".", "..", and absolute paths are all rejected.
func validSkillName(name string) error {
	if name == "" {
		return fmt.Errorf("empty skill name")
	}
	if strings.ContainsAny(name, `/\`) {
		return fmt.Errorf("skill name %q contains path separator", name)
	}
	if name == "." || name == ".." {
		return fmt.Errorf("skill name %q is a reserved path", name)
	}
	if filepath.IsAbs(name) {
		return fmt.Errorf("skill name %q is an absolute path", name)
	}
	return nil
}
