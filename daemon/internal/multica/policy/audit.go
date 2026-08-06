package policy

import (
	"encoding/json"
	"io"
	"sync"
	"time"
)

// InjectionAuditEntry is the fixed, redacted audit shape for injection decisions.
// Free-form detail and env/arg values are intentionally absent.
type InjectionAuditEntry struct {
	TS     string `json:"ts"`
	TaskID string `json:"taskId"`
	Source string `json:"source"`
	Kind   string `json:"kind"`
	Name   string `json:"name"`
	Digest string `json:"digest"`
	Result string `json:"result"`
	Reason string `json:"reason"`
}

// InjectionAudit writes redacted injection audit entries.
type InjectionAudit interface {
	Write(InjectionAuditEntry) error
}

// JSONLAudit writes one JSON object per line to w.
type JSONLAudit struct {
	mu sync.Mutex
	w  io.Writer
}

func NewJSONLAudit(w io.Writer) *JSONLAudit {
	return &JSONLAudit{w: w}
}

func (a *JSONLAudit) Write(entry InjectionAuditEntry) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if entry.TS == "" {
		entry.TS = time.Now().UTC().Format(time.RFC3339Nano)
	}
	// Re-encode through a fixed struct so callers cannot smuggle extra fields.
	safe := InjectionAuditEntry{
		TS:     entry.TS,
		TaskID: entry.TaskID,
		Source: entry.Source,
		Kind:   entry.Kind,
		Name:   entry.Name,
		Digest: entry.Digest,
		Result: entry.Result,
		Reason: entry.Reason,
	}
	b, err := json.Marshal(safe)
	if err != nil {
		return err
	}
	_, err = a.w.Write(append(b, '\n'))
	return err
}
