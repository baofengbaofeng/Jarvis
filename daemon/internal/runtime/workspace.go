package runtime

import (
	"fmt"
	"os"
	"path/filepath"
)

// WorkspacePool allocates per-task isolated directories under root (H1.12).
type WorkspacePool struct {
	root string
	fs   WorkspaceFS
}

// WorkspaceFS abstracts filesystem ops for testability.
type WorkspaceFS interface {
	MkdirAll(path string, perm os.FileMode) error
	RemoveAll(path string) error
	Stat(path string) (os.FileInfo, error)
}

type defaultFS struct{}

func (defaultFS) MkdirAll(p string, m os.FileMode) error { return os.MkdirAll(p, m) }
func (defaultFS) RemoveAll(p string) error               { return os.RemoveAll(p) }
func (defaultFS) Stat(p string) (os.FileInfo, error)     { return os.Stat(p) }

func NewWorkspacePool(root string) *WorkspacePool {
	return NewWorkspacePoolFS(root, defaultFS{})
}

func NewWorkspacePoolFS(root string, fs WorkspaceFS) *WorkspacePool {
	return &WorkspacePool{root: root, fs: fs}
}

// Allocate creates (or reuses) the isolated directory for taskID and returns its abs path.
func (p *WorkspacePool) Allocate(taskID string) (string, error) {
	if taskID == "" {
		return "", fmt.Errorf("workspace: empty task id")
	}
	dir := filepath.Join(p.root, taskID)
	if err := p.fs.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("workspace allocate %s: %w", taskID, err)
	}
	return dir, nil
}

// Cleanup removes the isolated directory for taskID.
func (p *WorkspacePool) Cleanup(taskID string) error {
	if taskID == "" {
		return nil
	}
	return p.fs.RemoveAll(filepath.Join(p.root, taskID))
}
