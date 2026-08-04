import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolRegistry } from '../agent/ToolRegistry';
import { Sandbox, type SandboxPolicy } from '../sandbox/Sandbox';

const exec = promisify(execFile);

export interface ShellDeps { execImpl?: (cmd: string, opts: { cwd: string; env: Record<string, string>; timeout?: number }) => Promise<{ stdout: string; stderr: string }> }

export function createShellTool(registry: ToolRegistry, policy: SandboxPolicy, deps: ShellDeps = {}, ignorePatterns?: string[]): void {
  // Execute via a spawn-array (no shell): the command is tokenized into argv and
  // passed straight to execFile, so `$()`, `>`, `|` etc. are inert literal args.
  // The sandbox's assertCommand already rejects shell metacharacters; running
  // without a shell keeps any escaped/chained input from being interpreted.
  const run = deps.execImpl ?? (async (cmd, opts) => {
    try {
      const argv = cmd.trim().split(/\s+/).filter(t => t.length > 0);
      if (argv.length === 0) return { stdout: '', stderr: '' };
      // execFile's env option REPLACES the process environment (it is not a
      // merge). The agent env vars (which typically lack PATH) must therefore
      // be layered over the parent process env, or commands outside libc's
      // default search path (e.g. git at /opt/homebrew/bin, npm, node shims)
      // would fail with ENOENT. Only string values are kept.
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
      Object.assign(env, opts.env);
      return await exec(argv[0], argv.slice(1), { cwd: opts.cwd, env, timeout: opts.timeout ?? 30_000 });
    } catch (e) { const err = e as { stdout?: string; stderr?: string }; return { stdout: err.stdout ?? '', stderr: err.stderr ?? String(e) }; }
  });

  registry.register({
    name: 'run_shell', description: 'Run a shell command within the workspace', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] }
  }, async (args, ctx) => {
    const sandbox = new Sandbox(ctx.workspaceRoot ?? ctx.cwd, policy, ignorePatterns);
    const command = String(args.command);
    sandbox.assertCommand(command);
    const { stdout, stderr } = await run(command, { cwd: ctx.cwd, env: ctx.env });
    return { ok: !stderr, output: `${stdout}${stderr ? '\n[stderr]\n' + stderr : ''}`.trim() };
  });
}
