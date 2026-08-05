package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/acp"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"
)

// ServerExtra 携带 M7 runtime 状态(L39)与注入冲突(L38)数据源;nil 安全——某个
// extra 未提供时,对应的 /runtime/* 端点不注册。向后兼容:现有 2 参数调用
// NewServer(version, q) 仍然成立(variadic)。
type ServerExtra interface{}

// RuntimeInfo 是 /runtime/status 端点服务的 L39 runtime 快照数据面。daemon 的
// runtimeState 实现它(registered/busy/activeTasks/lastHeartbeatAt/serverUrl/protocol)。
type RuntimeInfo interface {
	Registered() bool
	Busy() bool
	ActiveTasks() int
	LastHeartbeatAt() int64
	ServerURL() string
	CLIProtocol() string
}

// ConflictSource 是 /runtime/conflicts 端点服务的 L38 注入冲突数据面。定义在
// httpapi(搭配本地 ConflictItem)使 httpapi 不依赖 multica/client 包(避免依赖
// 环);daemon main 用 conflictAdapter 把 client.ConflictStore 适配进来。
type ConflictSource interface {
	Conflicts() []ConflictItem
}

// ConflictItem 与 client.ConflictItem 同构(相同的 JSON 形状),使 L38 数据能在
// 不 import client 包的前提下被 /runtime/conflicts 服务。
type ConflictItem struct {
	TaskID   string             `json:"taskId"`
	Skill    *acp.SkillConflict `json:"skill,omitempty"`
	MCP      *acp.MCPConflict   `json:"mcp,omitempty"`
	Resolved bool               `json:"resolved"`
}

type Server struct {
	version   string
	queue     *runtime.Queue
	mux       *http.ServeMux
	info      RuntimeInfo
	conflicts ConflictSource
}

func NewServer(version string, q *runtime.Queue, extras ...ServerExtra) *Server {
	s := &Server{version: version, queue: q, mux: http.NewServeMux()}
	for _, e := range extras {
		switch v := e.(type) {
		case RuntimeInfo:
			s.info = v
		case ConflictSource:
			s.conflicts = v
		}
	}
	s.routes()
	return s
}

func (s *Server) routes() {
	s.mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"ok": true, "pid": 0})
	})
	s.mux.HandleFunc("/status", func(w http.ResponseWriter, r *http.Request) {
		st := s.queue.Status()
		writeJSON(w, map[string]any{
			"running":     true,
			"version":     s.version,
			"activeTasks": st.ActiveTasks,
			"queued":      st.Queued,
			"perAgent":    st.PerAgent,
			"concurrency": st.Concurrency,
		})
	})
	// M7 Task 9 (L39 数据面): runtime 注册/繁忙/心跳快照。mode 由客户端
	// (DaemonSupervisor/deriveMode)从 registered/busy 推导,这里不上送。
	if s.info != nil {
		s.mux.HandleFunc("/runtime/status", func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, map[string]any{
				"registered":      s.info.Registered(),
				"busy":            s.info.Busy(),
				"activeTasks":     s.info.ActiveTasks(),
				"lastHeartbeatAt": s.info.LastHeartbeatAt(),
				"serverUrl":       s.info.ServerURL(),
				"protocol":        s.info.CLIProtocol(),
			})
		})
	}
	// M7 Task 9 (L38 数据面): 注入冲突列表,由 UI 决策后写 settings。
	if s.conflicts != nil {
		s.mux.HandleFunc("/runtime/conflicts", func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, s.conflicts.Conflicts())
		})
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func (s *Server) Handler() http.Handler { return s.mux }
