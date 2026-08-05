package client

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/acp"
)

// SkillFS abstracts skill copy filesystem ops (H1.7).
type SkillFS interface {
	ReadDir(dir string) ([]string, error)
	Copy(src, dst string) error
	MkdirAll(dir string) error
}

// applyInjection merges local + Multica injections (H1.6-H1.8), copies Multica
// skills into the task workspace .jarvis/skills/ (H1.7), and returns the merged
// TaskPayload handed to `jarvis-agent run`, plus L38 conflicts.
func applyInjection(ctx context.Context, p *acp.TaskPayload, local acp.Injection, workspace string, fs SkillFS) (*acp.TaskPayload, []acp.SkillConflict, []acp.MCPConflict, error) {
	remote := acp.Injection{MCPServers: p.MCPServers, Env: p.Env, CLIArgs: p.CLIArgs}
	merged, sc, mc := acp.MergeInjections(local, remote)

	out := *p
	out.MCPServers = merged.MCPServers
	out.Env = merged.Env
	out.CLIArgs = merged.CLIArgs

	if len(p.Skills) > 0 {
		dst := filepath.Join(workspace, ".jarvis", "skills")
		if err := fs.MkdirAll(dst); err != nil {
			return nil, nil, nil, fmt.Errorf("mkdir skills: %w", err)
		}
		for _, name := range p.Skills {
			src := filepath.Join(workspace, name)
			target := filepath.Join(dst, name)
			if err := fs.Copy(src, target); err != nil {
				return nil, nil, nil, fmt.Errorf("copy skill %s: %w", name, err)
			}
		}
		out.Skills = nil // Skill 内容已落盘 .jarvis/skills/,由 M3 SkillsLoader 扫描
	}
	return &out, sc, mc, nil
}
