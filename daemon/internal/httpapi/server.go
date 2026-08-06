package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/acp"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/policy"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"
)

// ServerExtra 携带 M7 runtime 状态(L39)与注入冲突(L38)数据源;nil 安全——某个
// extra 未提供时,对应的 /runtime/* 端点不注册。向后兼容:现有 2 参数调用
// NewServer(version, q) 仍然成立(variadic)。
type ServerExtra interface{}

// AuthToken is the shared Bearer secret for authenticated /v1/* routes (SEC-09).
type AuthToken string

// InjectionApprovalService wires pending MCP digest approvals to HTTP (SEC-09).
type InjectionApprovalService struct {
	Pending   policy.PendingApprovals
	Approvals policy.ApprovalStore
}

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
	version    string
	queue      *runtime.Queue
	mux        *http.ServeMux
	info       RuntimeInfo
	conflicts  ConflictSource
	authToken  string
	injections *InjectionApprovalService
}

func NewServer(version string, q *runtime.Queue, extras ...ServerExtra) *Server {
	s := &Server{version: version, queue: q, mux: http.NewServeMux()}
	for _, e := range extras {
		switch v := e.(type) {
		case RuntimeInfo:
			s.info = v
		case ConflictSource:
			s.conflicts = v
		case AuthToken:
			s.authToken = string(v)
		case *InjectionApprovalService:
			s.injections = v
		}
	}
	if s.authToken == "" {
		s.authToken = os.Getenv("JARVIS_DAEMON_TOKEN")
	}
	s.routes()
	return s
}

// NewServerWithAuth is the authenticated constructor used by /v1 routes.
func NewServerWithAuth(version string, q *runtime.Queue, token string, extras ...ServerExtra) *Server {
	all := append([]ServerExtra{AuthToken(token)}, extras...)
	return NewServer(version, q, all...)
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
	if s.injections != nil && s.injections.Pending != nil {
		s.mux.HandleFunc("GET /v1/runtime/injection-approvals", s.requireAuth(s.handleListInjectionApprovals))
		s.mux.HandleFunc("POST /v1/runtime/injection-approvals/{digest}", s.requireAuth(s.handleApproveInjection))
	}
}

func (s *Server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.authToken == "" || !bearerOK(r.Header.Get("Authorization"), s.authToken) {
			w.WriteHeader(http.StatusUnauthorized)
			writeJSON(w, map[string]string{"code": "UNAUTHORIZED", "detail": "missing or invalid bearer token"})
			return
		}
		next(w, r)
	}
}

func bearerOK(header, token string) bool {
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return false
	}
	return subtleConstantTimeEq(strings.TrimPrefix(header, prefix), token)
}

func subtleConstantTimeEq(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	var v byte
	for i := 0; i < len(a); i++ {
		v |= a[i] ^ b[i]
	}
	return v == 0
}

func (s *Server) handleListInjectionApprovals(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.injections.Pending.List())
}

func (s *Server) handleApproveInjection(w http.ResponseWriter, r *http.Request) {
	digest := r.PathValue("digest")
	var body struct {
		Kind string `json:"kind"`
		Name string `json:"name"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil || body.Kind == "" || body.Name == "" || digest == "" {
		w.WriteHeader(http.StatusBadRequest)
		writeJSON(w, map[string]string{"code": "APPROVAL_INVALID", "detail": "kind, name, and digest required"})
		return
	}
	pending, ok := s.injections.Pending.Get(digest)
	if !ok {
		w.WriteHeader(http.StatusNotFound)
		writeJSON(w, map[string]string{"code": "APPROVAL_NOT_FOUND", "detail": "unknown digest"})
		return
	}
	if pending.Kind != body.Kind || pending.Name != body.Name || pending.Digest != digest {
		w.WriteHeader(http.StatusConflict)
		writeJSON(w, map[string]string{"code": "APPROVAL_CONFLICT", "detail": "kind/name/digest mismatch"})
		return
	}
	status, _ := s.injections.Pending.ApproveExact(body.Kind, body.Name, digest)
	if status == "not_found" {
		w.WriteHeader(http.StatusNotFound)
		writeJSON(w, map[string]string{"code": "APPROVAL_NOT_FOUND", "detail": "unknown digest"})
		return
	}
	if status == "conflict" {
		w.WriteHeader(http.StatusConflict)
		writeJSON(w, map[string]string{"code": "APPROVAL_CONFLICT", "detail": "kind/name/digest mismatch"})
		return
	}
	if s.injections.Approvals != nil {
		if err := s.injections.Approvals.Approve(context.Background(), policy.ApprovalKey{
			Kind: body.Kind, Name: body.Name, Digest: digest,
		}); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			writeJSON(w, map[string]string{"code": "INTERNAL", "detail": "approval persist failed"})
			return
		}
	}
	// Approve persists the digest only — callers must explicitly retry the task.
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func (s *Server) Handler() http.Handler { return authMiddleware(s.authToken, s.mux) }
