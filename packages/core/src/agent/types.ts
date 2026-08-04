import type { ToolCall, Usage } from '../model/types';

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
