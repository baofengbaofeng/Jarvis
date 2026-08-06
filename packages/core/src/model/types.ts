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
