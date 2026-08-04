import type { Provider, ProviderType } from '@jarvis/protocol';

export type ModelRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ModelMessage {
  role: ModelRole;
  content: string;
  name?: string;
}

export interface ChatRequest {
  provider: Provider;
  modelId: string;
  messages: ModelMessage[];
  stream: boolean;
  maxTokens?: number;
  temperature?: number;
  reasoning?: 'low' | 'medium' | 'high';
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
