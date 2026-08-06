package policy

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFileApprovalStoreWrites0600AndRoundTrips(t *testing.T) {
	path := filepath.Join(t.TempDir(), "approvals.json")
	store := NewFileApprovalStore(path)
	key := ApprovalKey{Kind: "mcp", Name: "fs", Digest: strings.Repeat("a", 64)}
	if err := store.Approve(context.Background(), key); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("mode=%o", info.Mode().Perm())
	}
	ok, err := store.IsApproved(context.Background(), key)
	if err != nil || !ok {
		t.Fatalf("approved=%v err=%v", ok, err)
	}
}

func TestFileApprovalStoreRejectsWorldReadable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "approvals.json")
	if err := os.WriteFile(path, []byte(`[{"kind":"mcp","name":"fs","digest":"abc","approvedAt":"2026-01-01T00:00:00Z"}]`), 0o644); err != nil {
		t.Fatal(err)
	}
	store := NewFileApprovalStore(path)
	_, err := store.IsApproved(context.Background(), ApprovalKey{Kind: "mcp", Name: "fs", Digest: "abc"})
	if err == nil {
		t.Fatal("expected error for world-readable approvals file")
	}
}
