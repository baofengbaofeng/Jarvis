package main

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/db"
)

type fakeVersion string

func (f fakeVersion) Version() string { return string(f) }

type fakeHealth struct{ rep HealthReport }

func (f fakeHealth) Check(context.Context) HealthReport { return f.rep }

func TestVersionCmd(t *testing.T) {
	var buf bytes.Buffer
	root := NewRootCmd(&buf)
	root.AddCommand(NewVersionCmd(fakeVersion("1.2.3"), &buf))
	root.SetArgs([]string{"version"})
	if err := root.Execute(); err != nil {
		t.Fatal(err)
	}
	if got := buf.String(); !strings.Contains(got, "1.2.3") {
		t.Fatalf("expected version in %q", got)
	}
}

func TestHealthCmdOK(t *testing.T) {
	var buf bytes.Buffer
	root := NewRootCmd(&buf)
	rep := HealthReport{OK: true, CLIVersion: "0.1.0", Protocol: "ACP", NodeAvailable: true, Daemon: "ok"}
	root.AddCommand(NewHealthCmd(fakeHealth{rep}, &buf))
	root.SetArgs([]string{"health"})
	if err := root.Execute(); err != nil {
		t.Fatal(err)
	}
	var got HealthReport
	if err := json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &got); err != nil {
		t.Fatal(err)
	}
	if !got.OK || got.Daemon != "ok" || got.Protocol != "ACP" {
		t.Fatalf("unexpected report: %+v", got)
	}
}

func TestHealthCmdFailsWhenNotOK(t *testing.T) {
	var buf bytes.Buffer
	root := NewRootCmd(&buf)
	rep := HealthReport{OK: false, CLIVersion: "0.1.0", Protocol: "ACP", NodeAvailable: false, Errors: []string{"node not found"}}
	root.AddCommand(NewHealthCmd(fakeHealth{rep}, &buf))
	root.SetArgs([]string{"health"})
	if err := root.Execute(); err == nil {
		t.Fatal("expected error when report !OK")
	}
}

func TestListModelsCmd(t *testing.T) {
	var buf bytes.Buffer
	root := NewRootCmd(&buf)
	root.AddCommand(NewListModelsCmd(fakeLister{models: []db.ModelInfo{{ID: "m1", ProviderID: "p1", ModelID: "claude-sonnet-4-6", Name: "Sonnet"}}}, &buf))
	root.SetArgs([]string{"list-models"})
	if err := root.Execute(); err != nil {
		t.Fatal(err)
	}
	var got []db.ModelInfo
	if err := json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ModelID != "claude-sonnet-4-6" {
		t.Fatalf("unexpected: %+v", got)
	}
}

type fakeLister struct {
	models []db.ModelInfo
	err    error
}

func (f fakeLister) ListModels(context.Context) ([]db.ModelInfo, error) { return f.models, f.err }
