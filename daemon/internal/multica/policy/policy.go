package policy

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/baofengbaofeng/Jarvis/daemon/internal/multica/acp"
)

// CandidateInjection is a remote Multica injection candidate. It must never be
// copied into a RunSpec until Evaluate returns it as an approved Injection.
type CandidateInjection struct {
	MCPServers []acp.MCPEntry
	Skills     []acp.SkillSpec
	Env        map[string]string
	CLIArgs    []string
}

// PolicyConfig is the local allowlist for remote injections.
type PolicyConfig struct {
	AllowedMCPRoots []string
	AllowedCLIFlags []string
	AllowedEnv      []string
}

// ApprovalKey identifies one approved MCP executable digest.
type ApprovalKey struct {
	Kind   string
	Name   string
	Digest string
}

// ApprovalStore persists local MCP executable approvals.
type ApprovalStore interface {
	IsApproved(ctx context.Context, key ApprovalKey) (bool, error)
	Approve(ctx context.Context, key ApprovalKey) error
}

// Denial is one rejected candidate field.
type Denial struct {
	Kind   string
	Name   string
	Reason string
	Digest string
}

// ApprovalRequest asks the local user to approve one MCP digest.
type ApprovalRequest struct {
	Key ApprovalKey
}

// dangerousEnv is the fixed denylist (SEC-09). Values are never audited.
var dangerousEnv = map[string]struct{}{
	"NODE_OPTIONS": {}, "NODE_PATH": {}, "LD_PRELOAD": {}, "LD_LIBRARY_PATH": {},
	"DYLD_INSERT_LIBRARIES": {}, "DYLD_LIBRARY_PATH": {}, "PYTHONPATH": {},
	"RUBYOPT": {}, "PERL5OPT": {}, "BASH_ENV": {}, "ENV": {}, "GIT_SSH_COMMAND": {},
	"HTTP_PROXY": {}, "HTTPS_PROXY": {}, "ALL_PROXY": {},
}

// Evaluator applies local allowlists + MCP digest approval to remote candidates.
type Evaluator struct {
	cfg      PolicyConfig
	approvals ApprovalStore
}

// CandidateFromPayload lifts remote Multica fields into a CandidateInjection.
// Skills are name-only here; path materialization is deferred until after the
// agent policy gate (SEC-09) — claim-path ApplyInjection must not copy skills.
func CandidateFromPayload(p *acp.TaskPayload) CandidateInjection {
	if p == nil {
		return CandidateInjection{}
	}
	var skills []acp.SkillSpec
	for _, name := range p.Skills {
		skills = append(skills, acp.SkillSpec{Source: "multica", Name: name})
	}
	env := map[string]string{}
	for k, v := range p.Env {
		env[k] = v
	}
	return CandidateInjection{
		MCPServers: append([]acp.MCPEntry{}, p.MCPServers...),
		Skills:     skills,
		Env:        env,
		CLIArgs:    append([]string{}, p.CLIArgs...),
	}
}

func NewEvaluator(cfg PolicyConfig, approvals ApprovalStore) *Evaluator {
	allowedEnv := make([]string, len(cfg.AllowedEnv))
	copy(allowedEnv, cfg.AllowedEnv)
	allowedCLI := make([]string, len(cfg.AllowedCLIFlags))
	copy(allowedCLI, cfg.AllowedCLIFlags)
	allowedRoots := make([]string, len(cfg.AllowedMCPRoots))
	copy(allowedRoots, cfg.AllowedMCPRoots)
	return &Evaluator{
		cfg: PolicyConfig{
			AllowedMCPRoots: allowedRoots,
			AllowedCLIFlags: allowedCLI,
			AllowedEnv:      allowedEnv,
		},
		approvals: approvals,
	}
}

func (e *Evaluator) Evaluate(ctx context.Context, candidate CandidateInjection) (acp.Injection, []Denial, []ApprovalRequest, error) {
	out := acp.Injection{
		Env:     map[string]string{},
		CLIArgs: nil,
	}
	var denials []Denial
	var approvals []ApprovalRequest

	allowedEnv := toSet(e.cfg.AllowedEnv)
	for k, v := range candidate.Env {
		if _, bad := dangerousEnv[k]; bad {
			denials = append(denials, Denial{Kind: "env", Name: k, Reason: "DANGEROUS_ENV"})
			continue
		}
		if _, ok := allowedEnv[k]; !ok {
			denials = append(denials, Denial{Kind: "env", Name: k, Reason: "ENV_NOT_ALLOWED"})
			continue
		}
		out.Env[k] = v
	}

	allowedCLI := toSet(e.cfg.AllowedCLIFlags)
	for _, arg := range candidate.CLIArgs {
		name, reason := classifyCLIArg(arg)
		if reason != "" {
			denials = append(denials, Denial{Kind: "cli", Name: name, Reason: reason})
			continue
		}
		if _, ok := allowedCLI[name]; !ok {
			denials = append(denials, Denial{Kind: "cli", Name: name, Reason: "CLI_FLAG_NOT_ALLOWED"})
			continue
		}
		out.CLIArgs = append(out.CLIArgs, arg)
	}

	for _, sk := range candidate.Skills {
		if err := validSkillName(sk.Name); err != nil {
			denials = append(denials, Denial{Kind: "skill", Name: sk.Name, Reason: "SKILL_NAME_INVALID"})
			continue
		}
		out.Skills = append(out.Skills, sk)
	}

	for _, mcp := range candidate.MCPServers {
		d, req, entry, err := e.evaluateMCP(ctx, mcp)
		if err != nil {
			return acp.Injection{}, nil, nil, err
		}
		if d != nil {
			denials = append(denials, *d)
			continue
		}
		if req != nil {
			approvals = append(approvals, *req)
			continue
		}
		if entry != nil {
			out.MCPServers = append(out.MCPServers, *entry)
		}
	}

	return out, denials, approvals, nil
}

func (e *Evaluator) evaluateMCP(ctx context.Context, mcp acp.MCPEntry) (*Denial, *ApprovalRequest, *acp.MCPEntry, error) {
	if mcp.Command == "" || !filepath.IsAbs(mcp.Command) {
		return &Denial{Kind: "mcp", Name: mcp.Name, Reason: "MCP_PATH_NOT_ABSOLUTE"}, nil, nil, nil
	}
	resolved, err := filepath.EvalSymlinks(mcp.Command)
	if err != nil {
		return &Denial{Kind: "mcp", Name: mcp.Name, Reason: "MCP_PATH_UNRESOLVABLE"}, nil, nil, nil
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return &Denial{Kind: "mcp", Name: mcp.Name, Reason: "MCP_PATH_UNRESOLVABLE"}, nil, nil, nil
	}
	if !info.Mode().IsRegular() {
		return &Denial{Kind: "mcp", Name: mcp.Name, Reason: "MCP_NOT_REGULAR_FILE"}, nil, nil, nil
	}
	if info.Mode().Perm()&0o022 != 0 {
		return &Denial{Kind: "mcp", Name: mcp.Name, Reason: "MCP_WRITABLE_BY_OTHERS"}, nil, nil, nil
	}
	if !underAnyRoot(resolved, e.cfg.AllowedMCPRoots) {
		return &Denial{Kind: "mcp", Name: mcp.Name, Reason: "MCP_OUTSIDE_ALLOWED_ROOT"}, nil, nil, nil
	}

	// MCP env/args reuse the same env + CLI policy.
	sub := CandidateInjection{Env: mcp.Env, CLIArgs: mcp.Args}
	subOut, subDenials, _, err := e.Evaluate(ctx, sub)
	if err != nil {
		return nil, nil, nil, err
	}
	if len(subDenials) > 0 {
		d := subDenials[0]
		d.Kind = "mcp"
		if d.Name == "" {
			d.Name = mcp.Name
		}
		return &d, nil, nil, nil
	}

	digest, err := fileSHA256(resolved)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("hash mcp %s: %w", mcp.Name, err)
	}
	key := ApprovalKey{Kind: "mcp", Name: mcp.Name, Digest: digest}
	ok, err := e.approvals.IsApproved(ctx, key)
	if err != nil {
		return nil, nil, nil, err
	}
	if !ok {
		return nil, &ApprovalRequest{Key: key}, nil, nil
	}
	entry := acp.MCPEntry{
		Name:    mcp.Name,
		Command: resolved,
		Args:    append([]string{}, subOut.CLIArgs...),
		Env:     subOut.Env,
		Digest:  digest,
	}
	return nil, nil, &entry, nil
}

func classifyCLIArg(arg string) (name, reason string) {
	if arg == "" {
		return arg, "CLI_POSITIONAL_FORBIDDEN"
	}
	if strings.HasPrefix(arg, "@") {
		return arg, "CLI_RESPONSE_FILE_FORBIDDEN"
	}
	if !strings.HasPrefix(arg, "--") {
		return arg, "CLI_POSITIONAL_FORBIDDEN"
	}
	name = arg
	if i := strings.IndexByte(arg, '='); i >= 0 {
		name = arg[:i]
	}
	return name, ""
}

func underAnyRoot(path string, roots []string) bool {
	for _, root := range roots {
		if root == "" {
			continue
		}
		absRoot, err := filepath.Abs(root)
		if err != nil {
			continue
		}
		resolvedRoot, err := filepath.EvalSymlinks(absRoot)
		if err != nil {
			resolvedRoot = absRoot
		}
		rel, err := filepath.Rel(resolvedRoot, path)
		if err != nil {
			continue
		}
		if rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator))) {
			return true
		}
	}
	return false
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func toSet(items []string) map[string]struct{} {
	out := make(map[string]struct{}, len(items))
	for _, it := range items {
		out[it] = struct{}{}
	}
	return out
}

func validSkillName(name string) error {
	if name == "" {
		return fmt.Errorf("empty")
	}
	if strings.ContainsAny(name, `/\`) || name == "." || name == ".." || filepath.IsAbs(name) {
		return fmt.Errorf("invalid")
	}
	return nil
}
