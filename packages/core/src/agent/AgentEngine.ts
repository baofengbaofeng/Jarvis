import type { AgentConfig } from '@jarvis/protocol';
import type { ChatChunk, ChatRequest, Usage } from '../model/types';
import type { ToolRegistry } from './ToolRegistry';
import type { ApprovalRequest, TaskResult, ToolCall, ToolResult } from './types';
import type { SandboxPolicy } from '../sandbox/Sandbox';

export interface EngineChatFn {
  (req: ChatRequest, opts: { apiKey: string; signal?: AbortSignal; onChunk?: (c: ChatChunk) => void }): Promise<{ text: string; usage: Usage | null }>;
}

export interface AgentEngineConfig {
  modelRouter: { chat: EngineChatFn };
  toolRegistry: ToolRegistry;
  approvalGate?: (req: ApprovalRequest) => Promise<boolean>;
  maxSteps?: number;
  maxTokens?: number;
}

export interface EngineRunInput {
  agent: AgentConfig;
  messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>;
  cwd: string;
  env: Record<string, string>;
  apiKey: string;
  signal?: AbortSignal;
  onDelta?: (d: string) => void;
  onTool?: (call: ToolCall, result: ToolResult) => void;
  provider: { type: 'openai-compatible' | 'anthropic-compatible'; baseUrl: string };
  modelId: string;
  // Sandbox root forwarded to tool contexts (tools default to cwd when absent).
  workspaceRoot?: string;
  // Per-task sandbox policy forwarded to tool contexts (C6/J6). Tools fall back
  // to their registration-time policy when absent.
  policy?: SandboxPolicy;
}

export class AgentEngine {
  private maxSteps: number;
  // E10 (plan mode): the tool-name subset this engine may expose to the model.
  // ChatRequest has no `tools` field yet — it lands with the real-provider
  // REACT rework — so this set is stored for that wiring; today the plan-only
  // enforcement is the execution-side gate in the tasks approval closure.
  private visibleTools: string[] | null = null;
  constructor(private cfg: AgentEngineConfig) { this.maxSteps = cfg.maxSteps ?? 10; }

  setVisibleTools(names: string[]): void { this.visibleTools = names; }
  getVisibleTools(): string[] | null { return this.visibleTools; }

  async run(input: EngineRunInput): Promise<TaskResult> {
    const { agent, messages, cwd, env, apiKey, signal, onDelta, onTool, workspaceRoot, policy } = input;
    let working: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }> = [...messages];
    let toolCalls = 0;
    let totalUsage: Usage | null = null;
    let finalText = '';

    for (let step = 0; step < this.maxSteps; step++) {
      const req: ChatRequest = {
        provider: { id: agent.id, name: agent.name, type: input.provider.type, baseUrl: input.provider.baseUrl, apiKeyRef: '', createdAt: '', updatedAt: '' },
        modelId: input.modelId,
        messages: working,
        stream: true,
        maxTokens: this.cfg.maxTokens
      };

      let callCalls: ToolCall[] = [];
      const { text, usage } = await this.cfg.modelRouter.chat(req, {
        apiKey,
        signal,
        onChunk: (c) => {
          if (c.kind === 'delta') { onDelta?.(c.delta); }
          if (c.kind === 'tool_call') callCalls = callCalls.concat(c.toolCalls);
          if (c.kind === 'usage') totalUsage = c.usage;
        }
      });
      if (text) {
        finalText += text;
        working.push({ role: 'assistant', content: text });
      }
      if (usage) totalUsage = usage;

      if (callCalls.length === 0) break;

      for (const call of callCalls) {
        toolCalls++;
        if (this.cfg.approvalGate) {
          // Pass the run's own agent through so a shared engine (concurrent
          // tasks) scopes the gate to THIS task's agent, not a module-level
          // "current agent" that races across submissions. (M4 review finding 1)
          const ok = await this.cfg.approvalGate({ toolName: call.name, args: call.arguments, prompt: `run ${call.name}`, agent: input.agent });
          if (!ok) {
            working.push({ role: 'tool', content: `[denied] ${call.name}` });
            continue;
          }
        }
        // M6 final review (finding 3): thread the RUN's agent through to the
        // tool context so identity-sensitive tools (memory, delegate from) see
        // who issued this call even on the shared engine (last-registration-wins
        // otherwise mis-attributes writes to a different agent).
        const result = await this.cfg.toolRegistry.execute(call, { cwd, env, signal, workspaceRoot, policy, agent: input.agent });
        onTool?.(call, result);
        working.push({ role: 'tool', content: result.output });
      }
    }

    return { text: finalText, toolCalls, usage: totalUsage };
  }
}
