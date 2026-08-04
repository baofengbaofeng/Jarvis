import type { ToolRegistry } from '../../agent/ToolRegistry';
import { Sandbox, type SandboxPolicy } from '../../sandbox/Sandbox';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface RunTestsDeps { execImpl?: (cmd: string, opts: { cwd: string; env: Record<string, string> }) => Promise<{ stdout: string; stderr: string; code: number }> }

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

// M4 Task 5 (review fix): the run result carries the process exit code. The
// promisified execFile REJECTS on any non-zero exit; without propagating
// err.code, a command that fails with output only on stdout (no stderr) would
// report ok:true and silently terminate the E8 fix loop, while a passing run
// with npm deprecation warnings on stderr would report ok:false. runSafely
// converts ANY rejection (default execFile or injected execImpl) into a result
// with a code, defaulting to 1 when absent, so ok is derived from code === 0.
async function runSafely(fn: () => Promise<{ stdout: string; stderr: string; code: number }>): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    return await fn();
  } catch (e) {
    const err = e as { code?: number | string; stdout?: string; stderr?: string };
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: typeof err.code === 'number' ? err.code : 1 };
  }
}

// Default run path: a spawn-array (execFile with NO `shell`), identical to the
// run_shell hardening from M3 Task 2. The command is tokenized into argv and
// passed straight to execFile, so `;`, `$(...)`, `>` etc. are inert literal args
// — the sandbox's assertCommand already rejects shell metacharacters, and
// running without a shell keeps any escaped/chained input from being
// interpreted. execFile's env option REPLACES the process environment (it is not
// a merge), so the parent env (which carries PATH to npm/node shims) is layered
// under the agent env, mirroring the shell tool.
async function defaultExecFile(cmd: string, opts: { cwd: string; env: Record<string, string> }): Promise<{ stdout: string; stderr: string; code: number }> {
  const argv = cmd.trim().split(/\s+/).filter(t => t.length > 0);
  if (argv.length === 0) return { stdout: '', stderr: '', code: 0 };
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  Object.assign(env, opts.env);
  const r = await exec(argv[0], argv.slice(1), { cwd: opts.cwd, env, timeout: 60_000 });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: 0 };
}

export function registerRunTestsTool(registry: ToolRegistry, policy: SandboxPolicy, deps: RunTestsDeps = {}, ignorePatterns?: string[]): void {
  const run = deps.execImpl ?? defaultExecFile;
  registry.register({
    name: 'run_tests', description: 'Run the project test suite and report pass/fail output',
    parameters: { type: 'object', properties: { command: { type: 'string', description: 'override test command' } } }
  }, async (args, ctx) => {
    const command = String(args.command ?? 'npm test');
    const sandbox = new Sandbox(ctx.workspaceRoot ?? ctx.cwd, effectiveTestPolicy(ctx.policy, policy), ignorePatterns);
    sandbox.assertCommand(command);
    const { stdout, stderr, code } = await runSafely(() => run(command, { cwd: ctx.cwd, env: ctx.env }));
    // ok is derived from the EXIT CODE, not stderr: a failing runner that writes
    // only to stdout still reports ok:false, and npm deprecation warnings on
    // stderr do not turn a passing run into a failure.
    const output = `${stdout}${stderr ? '\n[stderr]\n' + stderr : ''}${code !== 0 ? `\n[exit code ${code}]` : ''}`.trim();
    return { ok: code === 0, output };
  });
}
