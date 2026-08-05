package acp

import (
	"encoding/json"
	"fmt"
)

// TaskPayload is the ACP-compatible task envelope received from a Multica Server.
// H1.3 接收 Task 上下文(issue/评论/指令);H1.6 mcpServers;H1.7 skills;H1.8 env/cliArgs;H1.14 profile;H1.5 conversation。
type TaskPayload struct {
	TaskID        string            `json:"taskId"`
	MulticaTaskID string            `json:"multicaTaskId"`
	Agent         string            `json:"agent,omitempty"`
	Instruction   string            `json:"instruction"`
	Context       *TaskContext      `json:"context,omitempty"`
	MCPServers    []MCPEntry        `json:"mcpServers,omitempty"`
	Skills        []string          `json:"skills,omitempty"`
	Env           map[string]string `json:"env,omitempty"`
	CLIArgs       []string          `json:"cliArgs,omitempty"`
	Profile       string            `json:"profile,omitempty"`
	Conversation  *string           `json:"conversation,omitempty"`
}

// TaskContext carries the issue/comment context the Task is attached to (H1.3).
type TaskContext struct {
	Issue       string   `json:"issue,omitempty"`
	Comments    []string `json:"comments,omitempty"`
	Instruction string   `json:"instruction,omitempty"`
}

// MCPEntry is a minimal stdio MCP server config injected by the Server (H1.6).
type MCPEntry struct {
	Name    string            `json:"name"`
	Command string            `json:"command"`
	Args    []string          `json:"args,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
}

// InitialMessage is a REACT-loop input message (role + content).
type InitialMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func ParseTaskPayload(data []byte) (*TaskPayload, error) {
	var p TaskPayload
	if err := json.Unmarshal(data, &p); err != nil {
		return nil, fmt.Errorf("parse task payload: %w", err)
	}
	if p.TaskID == "" {
		return nil, fmt.Errorf("task payload missing taskId")
	}
	if p.Instruction == "" && (p.Context == nil || p.Context.Instruction == "") {
		return nil, fmt.Errorf("task payload has no instruction or context instruction")
	}
	return &p, nil
}

// BuildInitialMessages converts a TaskPayload into the initial REACT-loop messages.
// 上下文优先级:payload.Instruction → context.Instruction;issue 为首条 user 消息;comments 依次追加(H1.3)。
func BuildInitialMessages(p *TaskPayload) []InitialMessage {
	var out []InitialMessage
	if p.Context != nil && p.Context.Issue != "" {
		out = append(out, InitialMessage{Role: "user", Content: p.Context.Issue})
	}
	if p.Context != nil {
		for _, c := range p.Context.Comments {
			if c != "" {
				out = append(out, InitialMessage{Role: "user", Content: c})
			}
		}
	}
	instr := p.Instruction
	if instr == "" && p.Context != nil {
		instr = p.Context.Instruction
	}
	if instr != "" {
		out = append(out, InitialMessage{Role: "user", Content: instr})
	}
	return out
}
