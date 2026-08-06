package policy

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type approvalRecord struct {
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	Digest     string `json:"digest"`
	ApprovedAt string `json:"approvedAt"`
}

// FileApprovalStore persists approved MCP digests as mode-0600 JSON.
type FileApprovalStore struct {
	path string
	mu   sync.Mutex
}

func NewFileApprovalStore(path string) *FileApprovalStore {
	return &FileApprovalStore{path: path}
}

func (s *FileApprovalStore) IsApproved(ctx context.Context, key ApprovalKey) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	recs, err := s.readLocked()
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	for _, r := range recs {
		if r.Kind == key.Kind && r.Name == key.Name && r.Digest == key.Digest {
			return true, nil
		}
	}
	return false, nil
}

func (s *FileApprovalStore) Approve(ctx context.Context, key ApprovalKey) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	recs, err := s.readLocked()
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	for _, r := range recs {
		if r.Kind == key.Kind && r.Name == key.Name && r.Digest == key.Digest {
			return nil
		}
	}
	recs = append(recs, approvalRecord{
		Kind:       key.Kind,
		Name:       key.Name,
		Digest:     key.Digest,
		ApprovedAt: time.Now().UTC().Format(time.RFC3339),
	})
	return s.writeLocked(recs)
}

func (s *FileApprovalStore) readLocked() ([]approvalRecord, error) {
	info, err := os.Stat(s.path)
	if err != nil {
		return nil, err
	}
	if info.Mode().Perm()&0o077 != 0 {
		return nil, fmt.Errorf("approvals file %s is group/world accessible", s.path)
	}
	data, err := os.ReadFile(s.path)
	if err != nil {
		return nil, err
	}
	var recs []approvalRecord
	if len(data) == 0 {
		return recs, nil
	}
	if err := json.Unmarshal(data, &recs); err != nil {
		return nil, err
	}
	return recs, nil
}

func (s *FileApprovalStore) writeLocked(recs []approvalRecord) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	data, err := json.Marshal(recs)
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := os.Chmod(tmp, 0o600); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, s.path)
}

// PendingApprovals is the concurrency-safe pending digest queue (in-memory or file).
type PendingApprovals interface {
	Put(PendingApproval)
	List() []PendingApproval
	Get(digest string) (PendingApproval, bool)
	ApproveExact(kind, name, digest string) (status string, pending PendingApproval)
}

// PendingApproval is one outstanding MCP digest awaiting local user approval.
type PendingApproval struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Digest    string `json:"digest"`
	TaskID    string `json:"taskId"`
	CreatedAt string `json:"createdAt"`
}

// PendingStore is an in-memory concurrency-safe queue of injection approval requests.
type PendingStore struct {
	mu       sync.Mutex
	byDigest map[string]PendingApproval
}

func NewPendingStore() *PendingStore {
	return &PendingStore{byDigest: map[string]PendingApproval{}}
}

func (s *PendingStore) Put(p PendingApproval) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if p.CreatedAt == "" {
		p.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}
	s.byDigest[p.Digest] = p
}

func (s *PendingStore) List() []PendingApproval {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]PendingApproval, 0, len(s.byDigest))
	for _, p := range s.byDigest {
		out = append(out, p)
	}
	return out
}

// ApproveExact removes a pending entry only when kind/name/digest all match.
// Returns ("", nil) on success; ("not_found", nil) or ("conflict", nil) otherwise.
func (s *PendingStore) ApproveExact(kind, name, digest string) (status string, pending PendingApproval) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.byDigest[digest]
	if !ok {
		return "not_found", PendingApproval{}
	}
	if p.Kind != kind || p.Name != name || p.Digest != digest {
		return "conflict", p
	}
	delete(s.byDigest, digest)
	return "", p
}

func (s *PendingStore) Get(digest string) (PendingApproval, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.byDigest[digest]
	return p, ok
}

// FilePendingStore persists pending approvals at mode 0600 for cross-process sharing
// between jarvis-agent and jarvis-daemon.
type FilePendingStore struct {
	path string
	mu   sync.Mutex
}

func NewFilePendingStore(path string) *FilePendingStore {
	return &FilePendingStore{path: path}
}

func (s *FilePendingStore) Put(p PendingApproval) {
	s.mu.Lock()
	defer s.mu.Unlock()
	items := s.readLocked()
	if p.CreatedAt == "" {
		p.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}
	found := false
	for i := range items {
		if items[i].Digest == p.Digest {
			items[i] = p
			found = true
			break
		}
	}
	if !found {
		items = append(items, p)
	}
	_ = s.writeLocked(items)
}

func (s *FilePendingStore) List() []PendingApproval {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.readLocked()
}

func (s *FilePendingStore) Get(digest string) (PendingApproval, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, p := range s.readLocked() {
		if p.Digest == digest {
			return p, true
		}
	}
	return PendingApproval{}, false
}

func (s *FilePendingStore) ApproveExact(kind, name, digest string) (status string, pending PendingApproval) {
	s.mu.Lock()
	defer s.mu.Unlock()
	items := s.readLocked()
	idx := -1
	for i, p := range items {
		if p.Digest == digest {
			idx = i
			pending = p
			break
		}
	}
	if idx < 0 {
		return "not_found", PendingApproval{}
	}
	if pending.Kind != kind || pending.Name != name || pending.Digest != digest {
		return "conflict", pending
	}
	items = append(items[:idx], items[idx+1:]...)
	_ = s.writeLocked(items)
	return "", pending
}

func (s *FilePendingStore) readLocked() []PendingApproval {
	info, err := os.Stat(s.path)
	if err != nil {
		return nil
	}
	if info.Mode().Perm()&0o077 != 0 {
		return nil
	}
	data, err := os.ReadFile(s.path)
	if err != nil || len(data) == 0 {
		return nil
	}
	var items []PendingApproval
	if err := json.Unmarshal(data, &items); err != nil {
		return nil
	}
	return items
}

func (s *FilePendingStore) writeLocked(items []PendingApproval) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	if items == nil {
		items = []PendingApproval{}
	}
	data, err := json.Marshal(items)
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	_ = os.Chmod(tmp, 0o600)
	return os.Rename(tmp, s.path)
}

// DefaultInjectionPaths returns ~/.jarvis injection approval/pending file paths.
func DefaultInjectionPaths() (approvals, pending string) {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	base := filepath.Join(home, ".jarvis")
	return filepath.Join(base, "injection-approvals.json"), filepath.Join(base, "injection-pending.json")
}

// LoadPolicyConfigFromEnv reads allowlists from JARVIS_ALLOWED_* env vars.
func LoadPolicyConfigFromEnv() PolicyConfig {
	return PolicyConfig{
		AllowedMCPRoots: splitCSV(os.Getenv("JARVIS_ALLOWED_MCP_ROOTS")),
		AllowedEnv:      splitCSV(os.Getenv("JARVIS_ALLOWED_ENV")),
		AllowedCLIFlags: splitCSV(os.Getenv("JARVIS_ALLOWED_CLI_FLAGS")),
	}
}

func splitCSV(s string) []string {
	if s == "" {
		return nil
	}
	var out []string
	for _, p := range strings.Split(s, ",") {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
