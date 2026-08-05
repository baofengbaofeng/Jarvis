package client

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

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

// ApplyInjection merges local + Multica injections (H1.6-H1.8), copies Multica
// skills into the task workspace .jarvis/skills/ (H1.7), and returns the merged
// TaskPayload handed to `jarvis-agent run`, plus L38 conflicts.
func ApplyInjection(ctx context.Context, p *acp.TaskPayload, local acp.Injection, workspace string, fs SkillFS) (*acp.TaskPayload, []acp.SkillConflict, []acp.MCPConflict, error) {
	dst := filepath.Join(workspace, ".jarvis", "skills")
	remote := acp.Injection{MCPServers: p.MCPServers, Env: p.Env, CLIArgs: p.CLIArgs}
	// Represent Multica-injected skills as SkillSpecs so L38 name collisions with
	// local skills are surfaced as SkillConflicts (C2: H1.7 skill-copy + L38).
	for _, name := range p.Skills {
		remote.Skills = append(remote.Skills, acp.SkillSpec{Source: "multica", Name: name, Path: filepath.Join(dst, name)})
	}
	merged, sc, mc := acp.MergeInjections(local, remote)

	out := *p
	out.MCPServers = merged.MCPServers
	out.Env = merged.Env
	out.CLIArgs = merged.CLIArgs

	if len(p.Skills) > 0 {
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
