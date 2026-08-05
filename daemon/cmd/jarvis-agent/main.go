package main

import (
	"os"
)

func main() {
	out := os.Stdout
	root := NewRootCmd(out)
	root.Version = cliVersion
	root.AddCommand(NewVersionCmd(staticVersion(cliVersion), out))
	root.AddCommand(NewHealthCmd(&defaultHealth{cliVersion: cliVersion}, out))
	if err := root.Execute(); err != nil {
		os.Exit(1)
	}
}
