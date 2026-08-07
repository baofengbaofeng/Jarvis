import type { ToolRegistry } from '../agent/ToolRegistry';
import type { SandboxPolicy } from '../sandbox/Sandbox';
import { Sandbox } from '../sandbox/Sandbox';

export interface GitDeps { execImpl?: (cmd: string, args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }> }

// M3 final review (J2): git tools no longer capture a fixed Sandbox root at
// registration time. The engine is shared across tasks while each agent has
// its own workspace, so the sandbox is built per-execution from the tool
// context's workspaceRoot (falling back to cwd), mirroring file/shell tools.
// A fixed registration-time root (e.g. process.cwd()) rejected every real
// bound workspace with "outside workspace".
export function createGitTools(registry: ToolRegistry, policy: SandboxPolicy, deps: GitDeps = {}, ignorePatterns?: string[]): void {
  const run = deps.execImpl ?? (async (cmd, args, cwd) => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    try { return await promisify(execFile)(cmd, args, { cwd }); }
    catch (e) { const err = e as { stdout?: string; stderr?: string }; return { stdout: err.stdout ?? '', stderr: err.stderr ?? String(e) }; }
  });

  // The brief's def ignores its args/makeArgs (the parameter schema is static);
  // underscore-prefixed because the repo enforces noUnusedParameters.
  const def = (
    name: string,
    description: string,
    sensitivity: 'safe' | 'ask',
    _args: string[],
    _makeArgs: (a: Record<string, unknown>) => string[],
  ) => ({
    name, description, parameters: { type: 'object', properties: {} }, sensitivity,
  });

  const mk = (name: string, description: string, sensitivity: 'safe' | 'ask', build: (a: Record<string, unknown>) => string[]) =>
    registry.register(def(name, description, sensitivity, build({}), build), async (args, ctx) => {
      const sandbox = new Sandbox(ctx.workspaceRoot ?? ctx.cwd, ctx.policy ?? policy, ignorePatterns);
      sandbox.assertRead(ctx.cwd); // repo 须在 workspace 内
      const argv = build(args);
      // CORE-12: enforce the same command allowlist as run_shell (readonly bans git write).
      sandbox.assertCommand(['git', ...argv].join(' '));
      const { stdout, stderr } = await run('git', argv, ctx.cwd);
      return { ok: !stderr, output: `${stdout}${stderr ? '\n' + stderr : ''}`.trim() };
    });

  mk('git_status', 'git status', 'safe', () => ['status', '--short']);
  mk('git_diff', 'git diff', 'safe', () => ['diff']);
  mk('git_log', 'git log', 'safe', () => ['log', '--oneline', '-10']);
  mk('git_add', 'git add', 'ask', (a) => ['add', String(a.path ?? '.')]);
  mk('git_branch', 'git branch', 'safe', () => ['branch', '--show-current']);
  mk('git_commit', 'git commit', 'ask', (a) => ['commit', '-m', String(a.message ?? '')]);
}
