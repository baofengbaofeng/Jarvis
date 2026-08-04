import type { ToolRegistry } from '../agent/ToolRegistry';
import type { Sandbox } from '../sandbox/Sandbox';

export interface GitDeps { execImpl?: (cmd: string, args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }> }

export function createGitTools(registry: ToolRegistry, sandbox: Sandbox, deps: GitDeps = {}): void {
  const run = deps.execImpl ?? (async (cmd, args, cwd) => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    try { return await promisify(execFile)(cmd, args, { cwd }); }
    catch (e) { const err = e as { stdout?: string; stderr?: string }; return { stdout: err.stdout ?? '', stderr: err.stderr ?? String(e) }; }
  });

  // The brief's def ignores its args/makeArgs (the parameter schema is static);
  // underscore-prefixed because the repo enforces noUnusedParameters.
  const def = (name: string, description: string, _args: string[], _makeArgs: (a: Record<string, unknown>) => string[]) => ({
    name, description, parameters: { type: 'object', properties: {} }
  });

  const mk = (name: string, description: string, build: (a: Record<string, unknown>) => string[]) =>
    registry.register(def(name, description, build({}), build), async (args, ctx) => {
      sandbox.assertRead(ctx.cwd); // repo 须在 workspace 内
      const { stdout, stderr } = await run('git', build(args), ctx.cwd);
      return { ok: !stderr, output: `${stdout}${stderr ? '\n' + stderr : ''}`.trim() };
    });

  mk('git_status', 'git status', () => ['status', '--short']);
  mk('git_diff', 'git diff', () => ['diff']);
  mk('git_log', 'git log', () => ['log', '--oneline', '-10']);
  mk('git_add', 'git add', (a) => ['add', String(a.path ?? '.')]);
  mk('git_branch', 'git branch', () => ['branch', '--show-current']);
  mk('git_commit', 'git commit', (a) => ['commit', '-m', String(a.message ?? '')]);
}
