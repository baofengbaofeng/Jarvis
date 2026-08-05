package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"

	"github.com/spf13/cobra"
)

const cliVersion = "0.1.0"

// VersionProvider returns the CLI version string (H1.1/L35 --version).
type VersionProvider interface{ Version() string }

type staticVersion string

func (s staticVersion) Version() string { return string(s) }

// HealthReport is the JSON body of `jarvis-agent --health` (H1.10 连通探测).
type HealthReport struct {
	OK            bool     `json:"ok"`
	CLIVersion    string   `json:"cliVersion"`
	Protocol      string   `json:"protocol"`
	NodeAvailable bool     `json:"nodeAvailable"`
	Daemon        string   `json:"daemon,omitempty"`
	Errors        []string `json:"errors,omitempty"`
}

// HealthChecker performs the runtime connectivity probe.
type HealthChecker interface {
	Check(ctx context.Context) HealthReport
}

// defaultHealth probes the local runtime (node availability); daemon ping is
// wired when the daemon URL is known (Task 8 wiring sets env JARVIS_DAEMON_URL).
type defaultHealth struct{ cliVersion string }

func (h *defaultHealth) Check(ctx context.Context) HealthReport {
	_, err := exec.LookPath("node")
	nodeOK := err == nil
	rep := HealthReport{OK: nodeOK, CLIVersion: h.cliVersion, Protocol: "ACP", NodeAvailable: nodeOK}
	if !nodeOK {
		rep.Errors = append(rep.Errors, "node not found in PATH")
	}
	return rep
}

// NewRootCmd builds the bare jarvis-agent CLI root. Version/health/list-models/run
// subcommands are added by main.go as dependencies become available.
func NewRootCmd(out io.Writer) *cobra.Command {
	root := &cobra.Command{
		Use:          "jarvis-agent",
		Short:        "JARVIS agent CLI — Multica ACP runtime",
		SilenceUsage: true,
	}
	root.SetOut(out)
	root.SetErr(out)
	return root
}

func NewVersionCmd(ver VersionProvider, out io.Writer) *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print the CLI version",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Fprintf(out, "jarvis-agent %s\n", ver.Version())
			return nil
		},
	}
}

func NewHealthCmd(hc HealthChecker, out io.Writer) *cobra.Command {
	return &cobra.Command{
		Use:   "health",
		Short: "Probe runtime connectivity",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			rep := hc.Check(cmd.Context())
			var buf bytes.Buffer
			if err := json.NewEncoder(&buf).Encode(rep); err != nil {
				return err
			}
			fmt.Fprint(out, buf.String())
			if !rep.OK {
				return fmt.Errorf("health check failed")
			}
			return nil
		},
	}
}
