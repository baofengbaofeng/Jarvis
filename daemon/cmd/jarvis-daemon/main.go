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
		handler := &client.ClaimHandler{
			API:       api,
			Queue:     q,
			ClientID:  func() string { return "jarvis" },
			AgentID:   "jarvis",
			Exec:      agentExec(&client.SubprocessAgentInvoker{}, st),
			Recorder:  &sqliteRecorder{},
			Conflicts: cs,
		}
		cl := client.NewClient(api, client.ClientOptions{Name: "jarvis", Version: "0.1.0", Concurrency: perAgent})
		go func() {
			if err := cl.Serve(ctx, func() client.HeartbeatStatus {
				st.mu.Lock()
				defer st.mu.Unlock()
				st.registered = true
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
	srv := httpapi.NewServer("0.1.1", q, extras...)
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

// agentExec 把任务交给 jarvis-agent 子进程执行并转发流帧(S6 端到端)。
func agentExec(invoker client.AgentInvoker, st *runtimeState) client.ExecFunc {
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
		res, err := invoker.RunTask(ctx, p, onChunk)
		return res, err
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

func (s *sqliteRecorder) Record(ctx context.Context, local, multica string) error {
	d, err := db.Open(defaultDBPath())
	if err != nil {
		return err
	}
	defer d.Close()
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
