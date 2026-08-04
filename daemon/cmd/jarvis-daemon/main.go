package main

import (
	"log"
	"net/http"
	"os"
	"strconv"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/httpapi"
	"github.com/baofengbaofeng/Jarvis/daemon/internal/runtime"
)

func main() {
	port := getenv("JARVIS_DAEMON_PORT", "17890")
	perAgent := getenvInt("JARVIS_CONCURRENCY_PER_AGENT", 6)
	machine := getenvInt("JARVIS_CONCURRENCY_MACHINE", 20)
	q := runtime.NewQueue(perAgent, machine)
	srv := httpapi.NewServer("0.1.1", q)
	log.Printf("jarvis-daemon on 127.0.0.1:%s concurrency %d/%d", port, perAgent, machine)
	if err := http.ListenAndServe("127.0.0.1:"+port, srv.Handler()); err != nil {
		log.Fatal(err)
	}
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
