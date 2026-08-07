import type { ToolCall, Usage } from '../model/types';
import type { SandboxPolicy } from '../sandbox/Sandbox';
import type { AgentConfig } from '@jarvis/protocol';

/** Declares how ApprovalGate should treat the tool when not in allowAlways. */
export type ToolSensitivity = 'safe' | 'ask' | 'deny';

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** CORE-11: declarative approval sensitivity (preferred over name hardcoding). */
  sensitivity?: ToolSensitivity;
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
  // The RUN's agent (M6 final review finding 3). The engine is SHARED across
  // concurrently-running tasks/squad members and tool handlers are registered
  // once with a baked identity, so a per-run agent here lets identity-sensitive
  // tools (memory memorize/recall, delegate_agent's from) resolve the agent that
  // ACTUALLY issued the call instead of the last-registered one. Falls back to
  // the baked id when absent.
  agent?: AgentConfig;
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
  // M4 final review (finding 1): the agent that owns this tool call. The engine
  // is SHARED across concurrently-running tasks (TaskOrchestrator concurrency 6),
  // so the approval gate must scope plan-only blocking and mcp grant consults to
  // the RUN's agent — a module-level "current agent" would race and let a
  // plan-only agent's mutating call pass (or wrongly block an edit agent).
  agent: AgentConfig;
}

export type { ToolCall };
