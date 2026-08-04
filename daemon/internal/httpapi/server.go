package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"
)

type Server struct {
	version string
	queue   *runtime.Queue
	mux     *http.ServeMux
}

func NewServer(version string, q *runtime.Queue) *Server {
	s := &Server{version: version, queue: q, mux: http.NewServeMux()}
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
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func (s *Server) Handler() http.Handler { return s.mux }
