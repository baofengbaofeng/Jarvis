const BLOCKED = /^(write_file|run_shell|git_add|git_commit|git_branch|mcp:|.*_write$|.*_commit$|.*_delete$)/;
export function isPlanBlocked(toolName: string): boolean {
  return BLOCKED.test(toolName);
}
export function planVisibleTools(all: string[], planEnabled: boolean): string[] {
  return planEnabled ? all.filter(t => !isPlanBlocked(t)) : all;
}
