import { describe, it, expect } from 'vitest';
import { createShellTool } from './shell';
import type { SandboxPolicy } from '../sandbox/Sandbox';
import { ToolRegistry } from '../agent/ToolRegistry';

// execFile's env option REPLACES the process environment (it is not a merge).
// run_shell must layer process.env under the agent env vars, otherwise commands
// found only via PATH (node, git, npm) fail with ENOENT when ctx.env lacks PATH.
describe('shell tool env merge', () => {
  it('inherits parent PATH and parent env vars when ctx.env is minimal', async () => {
    process.env.JARVIS_ENV_MERGE_MARKER = 'present';
    try {
      const reg = new ToolRegistry();
      const policy: SandboxPolicy = { level: 'readwrite', allowDomains: [], allowCommands: ['node'] };
      createShellTool(reg, policy); // default run path (real execFile)
      const ctx = { cwd: '/', env: {}, workspaceRoot: '/' };

      // node resolves only via the inherited PATH; the marker proves the parent
      // env was layered under the (PATH-less) agent env.
      const r = await reg.execute({ id: '1', name: 'run_shell', arguments: { command: 'node -p process.env.JARVIS_ENV_MERGE_MARKER' } }, ctx);
      expect(r.output).toContain('present');
    } finally {
      delete process.env.JARVIS_ENV_MERGE_MARKER;
    }
  });
});
