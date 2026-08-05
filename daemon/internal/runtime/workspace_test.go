package runtime

import (
	"os"
	"path/filepath"
	"testing"
)

type memFS struct {
	dirs    map[string]bool
	removed map[string]bool
}

func (m *memFS) MkdirAll(p string, _ os.FileMode) error {
	m.dirs[p] = true
	return nil
}

func (m *memFS) RemoveAll(p string) error {
	m.removed[p] = true
	delete(m.dirs, p)
	return nil
}

func (m *memFS) Stat(p string) (os.FileInfo, error) {
	if m.dirs[p] {
		return nil, nil
	}
	return nil, os.ErrNotExist
}

func TestWorkspaceAllocateAndCleanup(t *testing.T) {
	fs := &memFS{dirs: map[string]bool{}, removed: map[string]bool{}}
	pool := NewWorkspacePoolFS("/ws", fs)
	dir, err := pool.Allocate("task-1")
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join("/ws", "task-1")
	if dir != want {
		t.Fatalf("want %s got %s", want, dir)
	}
	if !fs.dirs[want] {
		t.Fatalf("dir not created")
	}
	if err := pool.Cleanup("task-1"); err != nil {
		t.Fatal(err)
	}
	if !fs.removed[want] {
		t.Fatalf("dir not removed")
	}
}

func TestWorkspaceAllocateEmptyID(t *testing.T) {
	pool := NewWorkspacePool("/ws")
	if _, err := pool.Allocate(""); err == nil {
		t.Fatal("expected error")
	}
}
