import type { ToolCall, Usage } from '../model/types';
import type { SandboxPolicy } from '../sandbox/Sandbox';

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolContext {
  cwd: string;
  env: Record<string, string>;
  signal?: AbortSignal;
  // Sandbox root for the tool invocation. Defaults to ctx.cwd when absent;
  // tools build their Sandbox per-execution from this so a shared engine can
  // enforce each task's own workspace.
  workspaceRoot?: string;
  // Per-task sandbox policy (M3 Task 9, C6/J6). When absent, tools fall back
  // to the policy captured at registration time, so a shared engine can still
  // run agents with different permission levels.
  policy?: SandboxPolicy;
}

export interface ToolResult {
  ok: boolean;
  output: string;
}

export interface TaskResult {
  text: string;
  toolCalls: number;
  usage: Usage | null;
}

export interface ApprovalRequest {
  toolName: string;
  args: Record<string, unknown>;
  prompt: string;
}

export type { ToolCall };
