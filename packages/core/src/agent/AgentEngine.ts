import type { AgentConfig } from '@jarvis/protocol';
import type { AssistantToolCallMessage, ChatChunk, ChatRequest, ModelMessage, ToolResultMessage, Usage } from '../model/types';
import { sumUsage } from '../model/usage';
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
  // CORE-19: per-run tool visibility (plan-only filter, etc.). Must not live on
  // the shared engine instance — concurrent tasks would race a mutable field.
  visibleTools?: string[];
}

export class AgentEngine {
  private maxSteps: number;
  constructor(private cfg: AgentEngineConfig) { this.maxSteps = cfg.maxSteps ?? 10; }

  async run(input: EngineRunInput): Promise<TaskResult> {
    const { agent, messages, cwd, env, apiKey, signal, onDelta, onTool, workspaceRoot, policy, visibleTools } = input;
    const working: ModelMessage[] = [...messages];
    let toolCalls = 0;
    const usageParts: Usage[] = [];
    let finalText = '';

    for (let step = 0; step < this.maxSteps; step++) {
      const allTools = this.cfg.toolRegistry.list();
      // CORE-19: filter from this run's input, not shared engine state.
      const visible = visibleTools
        ? allTools.filter(t => visibleTools.includes(t.name))
        : allTools;
      const req: ChatRequest = {
        provider: { id: agent.id, name: agent.name, type: input.provider.type, baseUrl: input.provider.baseUrl, apiKeyRef: '', createdAt: '', updatedAt: '' },
        modelId: input.modelId,
        // Snapshot: the loop keeps appending to `working` after this request
        // resolves, and an adapter must serialize the transcript it was given.
        messages: [...working],
        stream: true,
        maxTokens: this.cfg.maxTokens,
        ...(visible.length > 0 ? { tools: visible, toolChoice: 'auto' as const } : {})
      };

      let callCalls: ToolCall[] = [];
      let stepUsage: Usage | null = null;
      const { text, usage } = await this.cfg.modelRouter.chat(req, {
        apiKey,
        signal,
        onChunk: (c) => {
          if (c.kind === 'delta') { onDelta?.(c.delta); }
          if (c.kind === 'tool_call') callCalls = callCalls.concat(c.toolCalls);
          if (c.kind === 'usage') stepUsage = c.usage;
        }
      });
      if (text) finalText += text;
      // CORE-05: accumulate per-step usage; prefer the chat() return value when
      // present (same step's onChunk usage is a duplicate of that return).
      const stepTotal = usage ?? stepUsage;
      if (stepTotal) usageParts.push(stepTotal);

      if (callCalls.length === 0) {
        if (text) working.push({ role: 'assistant', content: text });
        break;
      }

      // Some OpenAI-compatible servers stream a tool call without an id. The
      // round trip is only valid when the assistant call and its result share
      // one non-empty id, so synthesize one before it is referenced twice.
      const calls = callCalls.map((c, i) => (c.id ? c : { ...c, id: `call_${step}_${i}` }));
      // CORE-01: record the assistant turn WITH its tool calls even when the
      // model emitted no text — otherwise the tool results pushed below dangle
      // and both providers reject the next request.
      const assistantTurn: AssistantToolCallMessage = { role: 'assistant', content: text, toolCalls: calls };
      working.push(assistantTurn);

      for (const call of calls) {
        toolCalls++;
        // CORE-03: truncated/invalid tool JSON must not execute as `{}`. Feed
        // the parse error back to the model as a tool result and skip execute.
        if (call.argumentsParseError) {
          const output = `[invalid arguments] ${call.argumentsParseError}`;
          const result = { ok: false, output };
          onTool?.(call, result);
          working.push(toolResult(call, output));
          continue;
        }
        if (this.cfg.approvalGate) {
          // Pass the run's own agent through so a shared engine (concurrent
          // tasks) scopes the gate to THIS task's agent, not a module-level
          // "current agent" that races across submissions. (M4 review finding 1)
          const ok = await this.cfg.approvalGate({ toolName: call.name, args: call.arguments, prompt: `run ${call.name}`, agent: input.agent });
          if (!ok) {
            working.push(toolResult(call, `[denied] ${call.name}`));
            continue;
          }
        }
        // M6 final review (finding 3): thread the RUN's agent through to the
        // tool context so identity-sensitive tools (memory, delegate from) see
        // who issued this call even on the shared engine (last-registration-wins
        // otherwise mis-attributes writes to a different agent).
        const result = await this.cfg.toolRegistry.execute(call, { cwd, env, signal, workspaceRoot, policy, agent: input.agent });
        onTool?.(call, result);
        working.push(toolResult(call, result.output));
      }
    }

    // CORE-05: sum across REACT steps instead of keeping only the last write.
    let totalUsage: Usage | null = null;
    if (usageParts.length > 0) {
      const s = sumUsage(usageParts);
      totalUsage = { promptTokens: s.promptTokens, completionTokens: s.completionTokens, totalTokens: s.totalTokens };
    }
    return { text: finalText, toolCalls, usage: totalUsage };
  }
}

function toolResult(call: ToolCall, output: string): ToolResultMessage {
  return { role: 'tool', content: output, toolCallId: call.id, name: call.name };
}
