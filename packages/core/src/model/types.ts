import type { Provider, ProviderType } from '@jarvis/protocol';
import type { MessageContent } from '../office/content';

export type ModelRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ModelMessage {
  role: ModelRole;
  // L23: a message may carry a content array (text + image_url parts) for
  // multimodal providers. `string | MessageContent` keeps plain-string callers
  // (the entire M1 path and all existing adapters.spec fixtures) untouched.
  content: string | MessageContent;
  name?: string;
  // CORE-01: the tool calls an assistant turn requested. Both wire protocols
  // need the calls themselves (not just their text) in the transcript, because
  // the tool results of the next turn reference them by id.
  toolCalls?: ToolCall[];
  // CORE-01: on a `tool` message, the id of the assistant tool call this result
  // answers. OpenAI rejects a tool message without `tool_call_id`; Anthropic has
  // no tool role at all and needs the id to build a `tool_result` block.
  toolCallId?: string;
}

// Narrowed views of ModelMessage for the two round-trip turns. ModelMessage
// itself stays a single lenient interface so the many callers that build history
// with a widened `role` (ChatService, ContextManager, agent/context) keep
// compiling; producers of tool turns should type their pushes as these instead,
// which makes the id non-optional where it actually matters.
export interface AssistantToolCallMessage extends ModelMessage {
  role: 'assistant';
  toolCalls: ToolCall[];
}

export interface ToolResultMessage extends ModelMessage {
  role: 'tool';
  toolCallId: string;
}

export interface ChatToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  provider: Provider;
  modelId: string;
  messages: ModelMessage[];
  stream: boolean;
  maxTokens?: number;
  temperature?: number;
  reasoning?: 'low' | 'medium' | 'high';
  tools?: ChatToolDef[];
  toolChoice?: 'auto' | 'none';
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type ChatChunk =
  | { kind: 'delta'; delta: string }
  | { kind: 'tool_call'; toolCalls: ToolCall[] }
  | { kind: 'usage'; usage: Usage }
  | { kind: 'done' }
  | { kind: 'error'; error: string };

export function isDoneChunk(c: ChatChunk): boolean { return c.kind === 'done'; }

export interface ChatCallbacks {
  onChunk: (chunk: ChatChunk) => void;
  signal?: AbortSignal;
}

export interface ProviderAdapter {
  type: ProviderType;
  chat(req: ChatRequest, ctx: { apiKey: string } & ChatCallbacks): Promise<void>;
}
