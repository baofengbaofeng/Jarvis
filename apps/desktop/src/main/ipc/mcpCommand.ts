import { basename, isAbsolute } from 'node:path';

/** Basename allowlist for MCP stdio launchers (DESK-12). Absolute paths also OK. */
const MCP_COMMAND_ALLOWLIST = new Set([
  'npx', 'npm', 'node', 'nodejs', 'uvx', 'uv', 'python', 'python3', 'bun', 'deno', 'docker',
]);

const MCP_UNSAFE = /[;&|`$<>\n\r]/;

export function assertMcpCommand(command: string, args: string[] = []): void {
  const cmd = command.trim();
  if (!cmd) throw new Error('MCP_COMMAND_REQUIRED');
  if (MCP_UNSAFE.test(cmd) || args.some(a => MCP_UNSAFE.test(a))) {
    throw new Error('MCP_COMMAND_UNSAFE');
  }
  const base = basename(cmd);
  if (!MCP_COMMAND_ALLOWLIST.has(base) && !isAbsolute(cmd)) {
    throw new Error('MCP_COMMAND_NOT_ALLOWED');
  }
}
