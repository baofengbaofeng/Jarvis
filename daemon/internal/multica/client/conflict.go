package client

import (
	"sync"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/acp"
)

// ConflictItem is one L38 injection conflict surfaced to the UI.
type ConflictItem struct {
	TaskID   string             `json:"taskId"`
	Skill    *acp.SkillConflict `json:"skill,omitempty"`
	MCP      *acp.MCPConflict   `json:"mcp,omitempty"`
	Resolved bool               `json:"resolved"`
}

// ConflictStore keeps the most recent injection conflicts for the UI (L38).
type ConflictStore struct {
	mu    sync.Mutex
	items []ConflictItem
}

func NewConflictStore() *ConflictStore { return &ConflictStore{} }

// maxConflicts caps the retained conflict list so a long-running daemon cannot
// grow it without bound (M2). Resolved items are dropped on Add — the UI only
// renders unresolved conflicts — and the tail (most recent) is kept past the cap.
const maxConflicts = 100

func (c *ConflictStore) Add(items ...ConflictItem) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.items = append(c.items, items...)
	keep := c.items[:0]
	for _, it := range c.items {
		if !it.Resolved {
			keep = append(keep, it)
		}
	}
	c.items = keep
	if len(c.items) > maxConflicts {
		c.items = append([]ConflictItem{}, c.items[len(c.items)-maxConflicts:]...)
	}
}

func (c *ConflictStore) Conflicts() []ConflictItem {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]ConflictItem{}, c.items...)
}

// Resolve marks the first unresolved conflict with name as resolved.
func (c *ConflictStore) Resolve(name, _ string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	for i := range c.items {
		key := ""
		if c.items[i].Skill != nil {
			key = c.items[i].Skill.Name
		}
		if c.items[i].MCP != nil {
			key = c.items[i].MCP.Name
		}
		if key == name && !c.items[i].Resolved {
			c.items[i].Resolved = true
			return true
		}
	}
	return false
}
