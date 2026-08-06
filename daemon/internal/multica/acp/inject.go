package acp

import "sort"

// Injection is the merged runtime injection for a Task (H1.6–H1.8).
type Injection struct {
	MCPServers []MCPEntry        `json:"mcpServers"`
	Skills     []SkillSpec       `json:"skills"`
	Env        map[string]string `json:"env"`
	CLIArgs    []string          `json:"cliArgs"`
}

// SkillSpec is a Skill reference: local workspace dir or Multica-injected dir (H1.7).
type SkillSpec struct {
	Source string `json:"source"` // "local" | "multica"
	Name   string `json:"name"`
	Path   string `json:"path"`
}

// SkillConflict is one name collision between a local and a Multica skill (L38).
type SkillConflict struct {
	Name        string `json:"name"`
	LocalPath   string `json:"localPath,omitempty"`
	MulticaPath string `json:"multicaPath,omitempty"`
}

// MCPConflict is one name collision between a local and a Multica MCP server (L38).
type MCPConflict struct {
	Name           string `json:"name"`
	LocalCommand   string `json:"localCommand,omitempty"`
	MulticaCommand string `json:"multicaCommand,omitempty"`
}

// MergeInjections merges local and Multica injections. 本地优先(Local 在前,Multica 不覆盖);
// 同名冲突不进 merged,返回冲突列表由 UI 决策(L38);无冲突的 Multica 项追加。
// remote 必须已通过本地 policy（SEC-09）；未批准的远端候选不得传入。
func MergeInjections(local, remote Injection) (Injection, []SkillConflict, []MCPConflict) {
	merged := Injection{
		MCPServers: append([]MCPEntry{}, local.MCPServers...),
		Skills:     append([]SkillSpec{}, local.Skills...),
		Env:        map[string]string{},
		CLIArgs:    append(append([]string{}, local.CLIArgs...), remote.CLIArgs...),
	}
	for k, v := range local.Env {
		merged.Env[k] = v
	}
	for k, v := range remote.Env {
		if _, ok := merged.Env[k]; !ok {
			merged.Env[k] = v
		}
	}

	localMcp := map[string]MCPEntry{}
	for _, m := range local.MCPServers {
		localMcp[m.Name] = m
	}
	localSkill := map[string]SkillSpec{}
	for _, s := range local.Skills {
		localSkill[s.Name] = s
	}

	var sc []SkillConflict
	for _, r := range remote.Skills {
		if ls, ok := localSkill[r.Name]; ok {
			sc = append(sc, SkillConflict{Name: r.Name, LocalPath: ls.Path, MulticaPath: r.Path})
		} else {
			merged.Skills = append(merged.Skills, r)
		}
	}
	var mc []MCPConflict
	for _, r := range remote.MCPServers {
		if lm, ok := localMcp[r.Name]; ok {
			mc = append(mc, MCPConflict{Name: r.Name, LocalCommand: lm.Command, MulticaCommand: r.Command})
		} else {
			merged.MCPServers = append(merged.MCPServers, r)
		}
	}
	sort.Slice(merged.Skills, func(i, j int) bool { return merged.Skills[i].Name < merged.Skills[j].Name })
	sort.Slice(merged.MCPServers, func(i, j int) bool { return merged.MCPServers[i].Name < merged.MCPServers[j].Name })
	return merged, sc, mc
}
