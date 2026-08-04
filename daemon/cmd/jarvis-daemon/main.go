package main

import (
	"log"
	"net/http"
	"os"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/httpapi"
)

func main() {
	port := os.Getenv("JARVIS_DAEMON_PORT")
	if port == "" {
		port = "17890"
	}
	srv := httpapi.NewServer("0.1.0")
	log.Printf("jarvis-daemon listening on 127.0.0.1:%s", port)
	if err := http.ListenAndServe("127.0.0.1:"+port, srv.Handler()); err != nil {
		log.Fatal(err)
	}
}
