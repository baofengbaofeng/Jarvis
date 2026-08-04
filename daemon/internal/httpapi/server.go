package httpapi

import (
	"encoding/json"
	"net/http"
)

type Server struct {
	version string
	mux     *http.ServeMux
}

func NewServer(version string) *Server {
	s := &Server{version: version, mux: http.NewServeMux()}
	s.routes()
	return s
}

func (s *Server) routes() {
	s.mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"ok": true, "pid": 0})
	})
	s.mux.HandleFunc("/status", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"running": true, "activeTasks": 0, "version": s.version})
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func (s *Server) Handler() http.Handler { return s.mux }
