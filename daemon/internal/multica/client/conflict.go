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

func (c *ConflictStore) Add(items ...ConflictItem) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.items = append(c.items, items...)
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
