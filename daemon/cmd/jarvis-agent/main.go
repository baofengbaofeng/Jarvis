package main

import (
	"log"
	"os"
	"path/filepath"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/db"
)

func main() {
	out := os.Stdout
	root := NewRootCmd(out)
	root.Version = cliVersion
	root.AddCommand(NewVersionCmd(staticVersion(cliVersion), out))
	root.AddCommand(NewHealthCmd(&defaultHealth{cliVersion: cliVersion}, out))

	if d, err := db.Open(defaultDBPath()); err != nil {
		log.Printf("warn: open db %s: %v", defaultDBPath(), err)
	} else {
		defer d.Close()
		root.AddCommand(NewListModelsCmd(sqliteModelLister{d: d}, out))
	}

	if err := root.Execute(); err != nil {
		os.Exit(1)
	}
}

func defaultDBPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(".", ".jarvis", "jarvis.db")
	}
	return filepath.Join(home, ".jarvis", "jarvis.db")
}
