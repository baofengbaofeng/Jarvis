import type { AgentConfig } from '@jarvis/protocol';
import type { ChatChunk, ChatRequest, Usage } from '../model/types';
import type { ToolRegistry } from './ToolRegistry';
import type { ApprovalRequest, TaskResult, ToolCall, ToolResult } from './types';

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
}

export class AgentEngine {
  private maxSteps: number;
  constructor(private cfg: AgentEngineConfig) { this.maxSteps = cfg.maxSteps ?? 10; }

  async run(input: EngineRunInput): Promise<TaskResult> {
    const { agent, messages, cwd, env, apiKey, signal, onDelta, onTool, workspaceRoot } = input;
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
          const ok = await this.cfg.approvalGate({ toolName: call.name, args: call.arguments, prompt: `run ${call.name}` });
          if (!ok) {
            working.push({ role: 'tool', content: `[denied] ${call.name}` });
            continue;
          }
        }
        const result = await this.cfg.toolRegistry.execute(call, { cwd, env, signal, workspaceRoot });
        onTool?.(call, result);
        working.push({ role: 'tool', content: result.output });
      }
    }

    return { text: finalText, toolCalls, usage: totalUsage };
  }
}
