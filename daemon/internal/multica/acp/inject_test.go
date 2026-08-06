package acp

import "testing"

func TestMergeInjectionLocalWinsEnvAndConflicts(t *testing.T) {
	local := Injection{
		Env:        map[string]string{"A": "local"},
		MCPServers: []MCPEntry{{Name: "fs", Command: "mcp-fs"}},
	}
	remote := Injection{
		Env:        map[string]string{"A": "remote", "B": "remote"},
		MCPServers: []MCPEntry{{Name: "fs", Command: "multica-fs"}},
	}
	merged, sc, mc := MergeInjections(local, remote)
	if merged.Env["A"] != "local" {
		t.Fatalf("local should win: %v", merged.Env)
	}
	if merged.Env["B"] != "remote" {
		t.Fatalf("remote unique key missing: %v", merged.Env)
	}
	if len(sc) != 0 {
		t.Fatalf("unexpected skill conflicts: %v", sc)
	}
	if len(mc) != 1 || mc[0].Name != "fs" || mc[0].MulticaCommand != "multica-fs" {
		t.Fatalf("unexpected mcp conflicts: %v", mc)
	}
	if len(merged.MCPServers) != 1 || merged.MCPServers[0].Command != "mcp-fs" {
		t.Fatalf("conflicting MCP should not be merged: %v", merged.MCPServers)
	}
}

func TestMergeInjectionSkillConflict(t *testing.T) {
	local := Injection{Skills: []SkillSpec{{Source: "local", Name: "review", Path: "/ws/skills/review"}}}
	remote := Injection{Skills: []SkillSpec{{Source: "multica", Name: "review", Path: "/ws/.jarvis/skills/review"}}}
	merged, sc, _ := MergeInjections(local, remote)
	if len(sc) != 1 || sc[0].Name != "review" {
		t.Fatalf("want 1 skill conflict: %v", sc)
	}
	if len(merged.Skills) != 1 || merged.Skills[0].Path != "/ws/skills/review" {
		t.Fatalf("local skill should remain: %v", merged.Skills)
	}
}

func TestMergeInjectionAppendsNonConflicting(t *testing.T) {
	local := Injection{Skills: []SkillSpec{{Source: "local", Name: "a", Path: "/a"}}}
	remote := Injection{Skills: []SkillSpec{{Source: "multica", Name: "b", Path: "/b"}}}
	merged, sc, _ := MergeInjections(local, remote)
	if len(sc) != 0 {
		t.Fatalf("no conflict expected: %v", sc)
	}
	if len(merged.Skills) != 2 {
		t.Fatalf("want both skills: %v", merged.Skills)
	}
}

func TestMergeInjectionCLIArgs(t *testing.T) {
	local := Injection{CLIArgs: []string{"--local"}}
	remote := Injection{CLIArgs: []string{"--remote-1", "--remote-2"}}
	merged, _, _ := MergeInjections(local, remote)
	if len(merged.CLIArgs) != 3 || merged.CLIArgs[0] != "--local" || merged.CLIArgs[1] != "--remote-1" {
		t.Fatalf("local CLI args first, then approved remote: %v", merged.CLIArgs)
	}
}

func TestMergeInjectionRequiresApprovedRemoteOnly(t *testing.T) {
	// Document the SEC-09 contract: MergeInjections trusts its remote argument.
	// Unapproved candidates must be filtered by policy.Evaluate before this call.
	local := Injection{}
	remote := Injection{Env: map[string]string{"SAFE": "1"}}
	merged, _, _ := MergeInjections(local, remote)
	if merged.Env["SAFE"] != "1" {
		t.Fatalf("approved remote env missing: %+v", merged.Env)
	}
}
