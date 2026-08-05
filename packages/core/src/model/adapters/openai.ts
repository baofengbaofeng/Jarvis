import type { ChatRequest, ChatChunk, ProviderAdapter } from '../types';
import { parseSSE } from '../../util/sse';
import { normalizeContent } from '../../office/content';

export interface AdapterDeps { fetchImpl?: typeof fetch }

export class OpenAIAdapter implements ProviderAdapter {
  readonly type = 'openai-compatible' as const;
  constructor(private deps: AdapterDeps = {}) {}

  async chat(req: ChatRequest, ctx: { apiKey: string; onChunk: (c: ChatChunk) => void; signal?: AbortSignal }): Promise<void> {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const url = `${req.provider.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
    const body = {
      model: req.modelId,
      // L23: normalize content arrays to OpenAI's content-part shape. String
      // content passes through unchanged, so existing requests are identical.
      messages: req.messages.map(m => ({ ...m, content: normalizeContent(m.content, 'openai') })),
      stream: true,
      stream_options: { include_usage: true },
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
    const toolCallAcc = new Map<number, { id: string; name: string; args: string }>();
    for await (const data of parseSSE(res.body)) {
      if (data === '[DONE]') break;
      const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string; tool_calls?: Array<{ index: number; id?: string | null; function?: { name?: string; arguments?: string } }> } }>; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } };
      const delta = parsed.choices?.[0]?.delta;
      if (delta?.content) ctx.onChunk({ kind: 'delta', delta: delta.content });
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const acc = toolCallAcc.get(tc.index) ?? { id: '', name: '', args: '' };
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name = tc.function.name;
          if (tc.function?.arguments) acc.args += tc.function.arguments;
          toolCallAcc.set(tc.index, acc);
        }
      }
      if (parsed.usage) {
        ctx.onChunk({ kind: 'usage', usage: { promptTokens: parsed.usage.prompt_tokens, completionTokens: parsed.usage.completion_tokens, totalTokens: parsed.usage.total_tokens } });
      }
    }
    for (const acc of toolCallAcc.values()) {
      ctx.onChunk({ kind: 'tool_call', toolCalls: [{ id: acc.id, name: acc.name, arguments: safeParseJson(acc.args) }] });
    }
    ctx.onChunk({ kind: 'done' });
  }
}

function safeParseJson(s: string): Record<string, unknown> {
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return {}; }
}
