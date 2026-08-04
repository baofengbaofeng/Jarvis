import type { ChatRequest, ChatChunk, ProviderAdapter } from '../types';
import { parseSSE } from '../../util/sse';

export interface AdapterDeps { fetchImpl?: typeof fetch }

export class OpenAIAdapter implements ProviderAdapter {
  readonly type = 'openai-compatible' as const;
  constructor(private deps: AdapterDeps = {}) {}

  async chat(req: ChatRequest, ctx: { apiKey: string; onChunk: (c: ChatChunk) => void; signal?: AbortSignal }): Promise<void> {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const url = `${req.provider.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
    const body = {
      model: req.modelId,
      messages: req.messages,
      stream: true,
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {})
    };
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify(body),
      signal: ctx.signal
    });
    if (!res.ok) throw new Error(`openai http ${res.status}: ${await res.text()}`);
    for await (const data of parseSSE(res.body)) {
      if (data === '[DONE]') break;
      const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } };
      const delta = parsed.choices?.[0]?.delta;
      if (delta?.content) ctx.onChunk({ kind: 'delta', delta: delta.content });
      if (delta?.tool_calls?.length) {
        ctx.onChunk({ kind: 'tool_call', toolCalls: delta.tool_calls.map(tc => ({ id: tc.id, name: tc.function.name, arguments: safeParseJson(tc.function.arguments) })) });
      }
      if (parsed.usage) {
        ctx.onChunk({ kind: 'usage', usage: { promptTokens: parsed.usage.prompt_tokens, completionTokens: parsed.usage.completion_tokens, totalTokens: parsed.usage.total_tokens } });
      }
    }
    ctx.onChunk({ kind: 'done' });
  }
}

function safeParseJson(s: string): Record<string, unknown> {
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return {}; }
}
