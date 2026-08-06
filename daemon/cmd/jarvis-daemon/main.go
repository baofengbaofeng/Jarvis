package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/db"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/httpapi"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/acp"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/client"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"
)

func main() {
	port := getenv("JARVIS_DAEMON_PORT", "17890")
	perAgent := getenvInt("JARVIS_CONCURRENCY_PER_AGENT", 6)
	machine := getenvInt("JARVIS_CONCURRENCY_MACHINE", 20)
	multicaURL := getenv("JARVIS_MULTICA_SERVER", "")

	q := runtime.NewQueue(perAgent, machine)
	st := &runtimeState{q: q, serverURL: multicaURL}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	// cs stays nil when Multica is disabled; the /runtime/conflicts endpoint only
	// registers (via conflictAdapter) when there is a live ConflictStore.
	var cs *client.ConflictStore
	if multicaURL != "" {
		api := &client.HTTPClientAPI{BaseURL: multicaURL, HTTP: &http.Client{Timeout: 10 * time.Second}}
		cs = client.NewConflictStore()
		pool := runtime.NewWorkspacePool(defaultWorkspaces())
		// cl is created before the handler so ClientID() can serve the
		// server-assigned id from Register (I3) rather than the literal "jarvis".
		cl := client.NewClient(api, client.ClientOptions{Name: "jarvis", Version: "0.1.0", Concurrency: perAgent})
		handler := &client.ClaimHandler{
			API:       api,
			Queue:     q,
			ClientID:  func() string { return cl.RegisteredID() },
			AgentID:   "jarvis",
			Exec:      agentExec(&client.SubprocessAgentInvoker{}, st, pool, client.DefaultSkillFS(), cs, acp.Injection{}),
			Recorder:  &sqliteRecorder{},
			Conflicts: cs,
		}
		go func() {
			defer func() {
				// I1: once the Serve loop exits, the client is no longer registered
				// (a deferred clear keeps the L39 mode from lying).
				st.mu.Lock()
				st.registered = false
				st.mu.Unlock()
			}()
			if err := cl.Serve(ctx, func() client.HeartbeatStatus {
				st.mu.Lock()
				defer st.mu.Unlock()
				st.registered = true
				// I4: an idle registered daemon still reports a fresh heartbeat.
				st.heartbeat = time.Now().Unix()
				return client.HeartbeatStatus{Status: heartbeatStatus(q), ActiveTasks: q.Status().ActiveTasks, UpdatedAt: time.Now().Unix()}
			}, func(tasks []client.ClaimedTask) { _ = handler.HandleClaims(ctx, tasks) }); err != nil {
				log.Printf("multica client stopped: %v", err)
			}
		}()
	}

	// Wire the L39 runtimeState onto /runtime/status and, when a ConflictStore
	// exists (Multica enabled), the L38 conflicts onto /runtime/conflicts.
	extras := []httpapi.ServerExtra{st}
	if cs != nil {
		extras = append(extras, conflictAdapter{cs})
	}
	srv := httpapi.NewServerWithAuth("0.1.1", q, getenv("JARVIS_DAEMON_TOKEN", ""), extras...)
	httpSrv := &http.Server{Addr: "127.0.0.1:" + port, Handler: srv.Handler()}
	// SIGTERM/SIGINT cancels ctx, which stops the Multica Serve goroutine; the
	// shutdown goroutine then drains the HTTP listener so the daemon terminates.
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := httpSrv.Shutdown(shutdownCtx); err != nil {
			log.Printf("http shutdown: %v", err)
		}
	}()
	log.Printf("jarvis-daemon on 127.0.0.1:%s concurrency %d/%d", port, perAgent, machine)
	if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

// runtimeState is the daemon's runtime snapshot (L39 数据面)。It carries the
// queue so ActiveTasks can be reported without an extra heap hop; the accessor
// set (Registered/Busy/ActiveTasks/LastHeartbeatAt/ServerURL/CLIProtocol) is the
// httpapi.RuntimeInfo surface that Task 9 wires onto the HTTP endpoints.
type runtimeState struct {
	mu         sync.Mutex
	q          *runtime.Queue
	registered bool
	busy       bool
	heartbeat  int64
	serverURL  string
}

func (s *runtimeState) Registered() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.registered
}

func (s *runtimeState) Busy() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.busy
}

func (s *runtimeState) ActiveTasks() int {
	return s.q.Status().ActiveTasks
}

func (s *runtimeState) LastHeartbeatAt() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.heartbeat
}

func (s *runtimeState) ServerURL() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.serverURL
}

func (s *runtimeState) CLIProtocol() string { return "acp" }

// conflictAdapter adapts client.ConflictStore's []client.ConflictItem into the
// httpapi-local ConflictItem shape (identical JSON) so the /runtime/conflicts
// endpoint can serve L38 data without httpapi importing the multica client
// package (avoids a dependency cycle).
type conflictAdapter struct{ cs *client.ConflictStore }

func (a conflictAdapter) Conflicts() []httpapi.ConflictItem {
	items := a.cs.Conflicts()
	out := make([]httpapi.ConflictItem, 0, len(items))
	for _, it := range items {
		out = append(out, httpapi.ConflictItem{
			TaskID:   it.TaskID,
			Skill:    it.Skill,
			MCP:      it.MCP,
			Resolved: it.Resolved,
		})
	}
	return out
}

func heartbeatStatus(q *runtime.Queue) string {
	if q.Status().ActiveTasks > 0 {
		return "busy"
	}
	return "idle"
}

// agentExec 把任务交给 jarvis-agent 子进程执行并转发流帧(S6 端到端)。C2 接线:
// 分配 task workspace → applyInjection(合并注入 + H1.7 skill 落盘)→ L38 冲突写入
// ConflictStore → 把合并后的 payload(而非原始 payload)交给 invoker。
func agentExec(invoker client.AgentInvoker, st *runtimeState, pool *runtime.WorkspacePool, skillFS client.SkillFS, conflicts *client.ConflictStore, local acp.Injection) client.ExecFunc {
	return func(ctx context.Context, p *acp.TaskPayload, onChunk func(runtime.StreamChunk)) (client.TaskResult, error) {
		st.mu.Lock()
		st.busy = true
		st.heartbeat = time.Now().Unix()
		st.mu.Unlock()
		defer func() {
			st.mu.Lock()
			st.busy = false
			st.mu.Unlock()
		}()

		ws, err := pool.Allocate(p.TaskID)
		if err != nil {
			return client.TaskResult{Status: "failed", Error: err.Error()}, err
		}
		defer func() { _ = pool.Cleanup(p.TaskID) }()

		merged, sc, mc, err := client.ApplyInjection(ctx, p, local, ws, skillFS)
		if err != nil {
			return client.TaskResult{Status: "failed", Error: err.Error()}, err
		}
		if conflicts != nil && (len(sc) > 0 || len(mc) > 0) {
			items := make([]client.ConflictItem, 0, len(sc)+len(mc))
			for i := range sc {
				items = append(items, client.ConflictItem{TaskID: p.TaskID, Skill: &sc[i]})
			}
			for i := range mc {
				items = append(items, client.ConflictItem{TaskID: p.TaskID, MCP: &mc[i]})
			}
			conflicts.Add(items...)
		}
		return invoker.RunTask(ctx, merged, onChunk)
	}
}

func defaultWorkspaces() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(".", ".jarvis", "workspaces")
	}
	return filepath.Join(home, ".jarvis", "workspaces")
}

func defaultDBPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(".", ".jarvis", "jarvis.db")
	}
	return filepath.Join(home, ".jarvis", "jarvis.db")
}

type sqliteRecorder struct{}

// Record persists the L36 mapping for a Multica-claimed task. §13.3 makes the
// M7+ Multica path daemon-written: ensure the local `tasks` row exists before
// MapTaskIDs' UPDATE so the mapping is not lost on a nonexistent row (C1).
func (s *sqliteRecorder) Record(ctx context.Context, local, multica string) error {
	d, err := db.Open(defaultDBPath())
	if err != nil {
		return err
	}
	defer d.Close()
	if err := db.EnsureTaskRow(ctx, d, local, "jarvis", "{}"); err != nil {
		return err
	}
	return db.MapTaskIDs(ctx, d, local, multica)
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func getenvInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
