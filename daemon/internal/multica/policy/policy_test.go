package policy

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/acp"
)

type fakeApprovals struct {
	approved map[ApprovalKey]bool
}

func (f fakeApprovals) IsApproved(_ context.Context, key ApprovalKey) (bool, error) {
	if f.approved == nil {
		return false, nil
	}
	return f.approved[key], nil
}

func (f fakeApprovals) Approve(context.Context, ApprovalKey) error { return nil }

func assertDenial(t *testing.T, denials []Denial, name, reason string) {
	t.Helper()
	for _, d := range denials {
		if d.Name == name && d.Reason == reason {
			return
		}
	}
	t.Fatalf("missing denial name=%q reason=%q in %#v", name, reason, denials)
}

func TestEvaluateRejectsDangerousEnvAndUndeclaredCLI(t *testing.T) {
	e := NewEvaluator(PolicyConfig{
		AllowedEnv:      []string{"LOG_LEVEL"},
		AllowedCLIFlags: []string{"--verbose"},
	}, fakeApprovals{})
	_, denials, approvals, err := e.Evaluate(context.Background(), CandidateInjection{
		Env:     map[string]string{"NODE_OPTIONS": "--require /tmp/pwn.js", "LOG_LEVEL": "debug"},
		CLIArgs: []string{"--verbose", "--config=/tmp/pwn"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(approvals) != 0 {
		t.Fatalf("unexpected approvals: %#v", approvals)
	}
	assertDenial(t, denials, "NODE_OPTIONS", "DANGEROUS_ENV")
	assertDenial(t, denials, "--config", "CLI_FLAG_NOT_ALLOWED")
}

func TestEvaluateRequiresApprovalForAllowedMCPDigest(t *testing.T) {
	root := t.TempDir()
	bin := filepath.Join(root, "fs-server")
	content := []byte("#!/bin/sh\necho ok\n")
	if err := os.WriteFile(bin, content, 0o755); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(content)
	digest := hex.EncodeToString(sum[:])

	e := NewEvaluator(PolicyConfig{AllowedMCPRoots: []string{root}}, fakeApprovals{})
	inj, denials, approvals, err := e.Evaluate(context.Background(), CandidateInjection{
		MCPServers: []acp.MCPEntry{{Name: "fs", Command: bin}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(denials) != 0 || len(approvals) != 1 || approvals[0].Key.Name != "fs" {
		t.Fatalf("want one local approval: denials=%#v approvals=%#v", denials, approvals)
	}
	if approvals[0].Key.Kind != "mcp" || approvals[0].Key.Digest != digest {
		t.Fatalf("unexpected approval key: %#v", approvals[0].Key)
	}
	if len(inj.MCPServers) != 0 {
		t.Fatalf("unapproved MCP must not enter injection: %#v", inj.MCPServers)
	}
}

func TestEvaluateAllowsApprovedMCP(t *testing.T) {
	root := t.TempDir()
	bin := filepath.Join(root, "fs-server")
	content := []byte("#!/bin/sh\necho ok\n")
	if err := os.WriteFile(bin, content, 0o755); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(content)
	key := ApprovalKey{Kind: "mcp", Name: "fs", Digest: hex.EncodeToString(sum[:])}

	e := NewEvaluator(PolicyConfig{AllowedMCPRoots: []string{root}}, fakeApprovals{
		approved: map[ApprovalKey]bool{key: true},
	})
	inj, denials, approvals, err := e.Evaluate(context.Background(), CandidateInjection{
		MCPServers: []acp.MCPEntry{{Name: "fs", Command: bin}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(denials) != 0 || len(approvals) != 0 {
		t.Fatalf("want clean approve: denials=%#v approvals=%#v", denials, approvals)
	}
	if len(inj.MCPServers) != 1 || inj.MCPServers[0].Name != "fs" {
		t.Fatalf("approved MCP missing: %#v", inj.MCPServers)
	}
	if inj.MCPServers[0].Digest != key.Digest {
		t.Fatalf("approved MCP missing digest: %#v", inj.MCPServers[0])
	}
}

func TestEvaluateRejectsRelativeMCPAndPositionals(t *testing.T) {
	e := NewEvaluator(PolicyConfig{
		AllowedMCPRoots: []string{"/opt/mcp"},
		AllowedCLIFlags: []string{"--verbose"},
	}, fakeApprovals{})
	_, denials, _, err := e.Evaluate(context.Background(), CandidateInjection{
		MCPServers: []acp.MCPEntry{{Name: "rel", Command: "mcp-rel"}},
		CLIArgs:    []string{"positional", "@resp.txt"},
	})
	if err != nil {
		t.Fatal(err)
	}
	assertDenial(t, denials, "rel", "MCP_PATH_NOT_ABSOLUTE")
	assertDenial(t, denials, "positional", "CLI_POSITIONAL_FORBIDDEN")
	assertDenial(t, denials, "@resp.txt", "CLI_RESPONSE_FILE_FORBIDDEN")
}
