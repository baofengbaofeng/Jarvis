import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerRunTestsTool } from './runTests';
import { ToolRegistry } from '../../agent/ToolRegistry';
import { SandboxError, type SandboxPolicy } from '../../sandbox/Sandbox';

// Verifies the two M4 Task 5 controller fixes on the run_tests tool:
//  (1) no-shell spawn-array execution (execFile, no `shell`), so `$()`, `>`,
//      `;` etc. are inert literal args like the M3 run_shell hardening; and
//  (2) a test-command-allowing policy so the default `npm test` is NOT blocked
//      by assertCommand even under a per-agent policy with an empty allowlist
//      (which would otherwise fall back to the sandbox DEFAULT_COMMAND_WHITELIST,
//      which has no npm/pnpm/yarn).
describe('run_tests tool', () => {
  const testPolicy: SandboxPolicy = { level: 'readwrite', allowDomains: [], allowCommands: ['npm test', 'pnpm test', 'yarn test'] };
  // Simulates an agent with no saved allowlist (C6/J6 default: empty
  // allowCommands -> DEFAULT_COMMAND_WHITELIST) — the exact blocker fixed by
  // the effectiveTestPolicy merge inside registerRunTestsTool.
  const agentCtx = { cwd: '/ws', env: {}, workspaceRoot: '/ws', policy: { level: 'readwrite' as const, allowDomains: [], allowCommands: [] } };

  it('allows the default `npm test` despite an empty per-agent allowlist', async () => {
    const reg = new ToolRegistry();
    const seen: string[] = [];
    registerRunTestsTool(reg, testPolicy, { execImpl: async (cmd) => { seen.push(cmd); return { stdout: 'ok', stderr: '' }; } });
    const r = await reg.execute({ id: '1', name: 'run_tests', arguments: {} }, agentCtx);
    expect(seen).toEqual(['npm test']);
    expect(r.ok).toBe(true);
  });

  it('rejects metacharacter chaining at assertCommand', async () => {
    const reg = new ToolRegistry();
    registerRunTestsTool(reg, testPolicy, { execImpl: async () => ({ stdout: '', stderr: '' }) });
    await expect(reg.execute({ id: '1', name: 'run_tests', arguments: { command: 'npm test; rm -rf /' } }, agentCtx))
      .rejects.toThrow(SandboxError);
  });

  it('does not execute command substitution or redirection (no-shell spawn-array)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-runtests-verify-'));
    const evil = join(dir, 'EVIL');
    try {
      const reg = new ToolRegistry();
      // echo is whitelisted here purely as the no-shell harness; `$()` and `>`
      // pass assertCommand (not rejected metacharacters) but must stay inert
      // literal args because the default run path is execFile without a shell.
      const policy: SandboxPolicy = { level: 'readwrite', allowDomains: [], allowCommands: ['echo', ...testPolicy.allowCommands] };
      registerRunTestsTool(reg, policy); // default run path (real execFile, NO shell)
      const r1 = await reg.execute({ id: '1', name: 'run_tests', arguments: { command: `echo $(touch ${evil})` } }, { cwd: dir, env: {}, workspaceRoot: dir });
      expect(existsSync(evil)).toBe(false);
      expect(r1.output).toContain('$(touch');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
