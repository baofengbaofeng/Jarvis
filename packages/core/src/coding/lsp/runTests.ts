import type { ToolRegistry } from '../../agent/ToolRegistry';
import { Sandbox, type SandboxPolicy } from '../../sandbox/Sandbox';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface RunTestsDeps { execImpl?: (cmd: string, opts: { cwd: string; env: Record<string, string> }) => Promise<{ stdout: string; stderr: string }> }

// M4 Task 5 (controller fix #2): run_tests is explicitly a TEST RUNNER — the
// project test commands from its registration policy must remain permitted even
// when a per-agent policy (ctx.policy with empty allowCommands, which falls back
// to the sandbox DEFAULT_COMMAND_WHITELIST that has no `npm`/`pnpm`/`yarn`)
// would otherwise block the tool's default `npm test` at assertCommand. Level
// restrictions still apply: a readonly agent uses the readonly whitelist and
// cannot run tests that mutate the workspace.
function effectiveTestPolicy(ctxPolicy: SandboxPolicy | undefined, registrationPolicy: SandboxPolicy): SandboxPolicy {
  const base = ctxPolicy ?? registrationPolicy;
  const merged = new Set([...(base.allowCommands ?? []), ...(registrationPolicy.allowCommands ?? [])]);
  return { ...base, allowCommands: [...merged] };
}

export function registerRunTestsTool(registry: ToolRegistry, policy: SandboxPolicy, deps: RunTestsDeps = {}, ignorePatterns?: string[]): void {
  // M4 Task 5 (controller fix #1): the default run path is a spawn-array
  // (execFile with NO `shell`), identical to the run_shell hardening from M3
  // Task 2. The command is tokenized into argv and passed straight to execFile,
  // so `;`, `$(...)`, `>` etc. are inert literal args — the sandbox's
  // assertCommand already rejects shell metacharacters, and running without a
  // shell keeps any escaped/chained input from being interpreted. execFile's
  // env option REPLACES the process environment (it is not a merge), so the
  // parent env (which carries PATH to npm/node shims) is layered under the
  // agent env, mirroring the shell tool.
  const run = deps.execImpl ?? (async (cmd, opts) => {
    try {
      const argv = cmd.trim().split(/\s+/).filter(t => t.length > 0);
      if (argv.length === 0) return { stdout: '', stderr: '' };
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
      Object.assign(env, opts.env);
      return await exec(argv[0], argv.slice(1), { cwd: opts.cwd, env, timeout: 60_000 });
    } catch (e) { const err = e as { stdout?: string; stderr?: string }; return { stdout: err.stdout ?? '', stderr: err.stderr ?? String(e) }; }
  });
  registry.register({
    name: 'run_tests', description: 'Run the project test suite and report pass/fail output',
    parameters: { type: 'object', properties: { command: { type: 'string', description: 'override test command' } } }
  }, async (args, ctx) => {
    const command = String(args.command ?? 'npm test');
    const sandbox = new Sandbox(ctx.workspaceRoot ?? ctx.cwd, effectiveTestPolicy(ctx.policy, policy), ignorePatterns);
    sandbox.assertCommand(command);
    const { stdout, stderr } = await run(command, { cwd: ctx.cwd, env: ctx.env });
    const output = `${stdout}${stderr ? '\n[stderr]\n' + stderr : ''}`.trim();
    return { ok: !stderr, output };
  });
}
