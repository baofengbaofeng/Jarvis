import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createShellTool } from './shell';
import type { SandboxPolicy } from '../sandbox/Sandbox';
import { ToolRegistry } from '../agent/ToolRegistry';

// Verifies the no-shell fix: run_shell tokenizes into a spawn-array (execFile
// with no `shell` option), so `$()` command substitution and `>` redirection
// are INERT literal args, even when they pass the sandbox metachar check.
describe('run_shell no-shell execution (temporary verification)', () => {
  it('does not execute command substitution or redirection', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-shell-verify-'));
    const evilSub = join(dir, 'EVIL_SUB');
    const evilRedir = join(dir, 'EVIL_REDIR');
    try {
      const reg = new ToolRegistry();
      const policy: SandboxPolicy = { level: 'readwrite', allowDomains: [], allowCommands: ['ls', 'echo'] };
      createShellTool(reg, policy); // default run path (real execFile, NO shell)
      const ctx = { cwd: dir, env: {}, workspaceRoot: dir };

      // `$()` passes the sandbox (base command 'echo' is whitelisted; `$` is
      // not a rejected metachar) but must NOT run `touch` because no shell is
      // interpreting the line.
      const r1 = await reg.execute({ id: '1', name: 'run_shell', arguments: { command: `echo $(touch ${evilSub})` } }, ctx);
      expect(existsSync(evilSub)).toBe(false);
      expect(r1.output).toContain('$(touch');

      // `>` passes the sandbox (base command 'ls' whitelisted) but must NOT
      // redirect into the file; it becomes a literal arg to ls.
      const r2 = await reg.execute({ id: '2', name: 'run_shell', arguments: { command: `ls > ${evilRedir}` } }, ctx);
      expect(existsSync(evilRedir)).toBe(false);
      expect(r2.ok).toBe(false); // ls errors on the literal '>' path, but no file was created
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
