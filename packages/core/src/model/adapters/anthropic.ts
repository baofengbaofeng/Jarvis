import type { ChatRequest, ChatChunk, ProviderAdapter } from '../types';
import { parseSSE } from '../../util/sse';

export class AnthropicAdapter implements ProviderAdapter {
  readonly type = 'anthropic-compatible' as const;
  constructor(private deps: { fetchImpl?: typeof fetch } = {}) {}

  async chat(req: ChatRequest, ctx: { apiKey: string; onChunk: (c: ChatChunk) => void; signal?: AbortSignal }): Promise<void> {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const url = `${req.provider.baseUrl.replace(/\/$/, '')}/v1/messages`;
    const system = req.messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
    const rest = req.messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }));
    const body = {
      model: req.modelId,
      max_tokens: req.maxTokens ?? 4096,
      system: system || undefined,
      messages: rest,
      stream: true
    };
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ctx.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: ctx.signal
    });
    if (!res.ok) throw new Error(`anthropic http ${res.status}: ${await res.text()}`);
    for await (const data of parseSSE(res.body)) {
      const parsed = JSON.parse(data) as { type?: string; delta?: { type?: string; text?: string; partial_json?: string }; index?: number; message?: { usage?: { input_tokens: number; output_tokens: number } } };
      if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta' && parsed.delta.text) {
        ctx.onChunk({ kind: 'delta', delta: parsed.delta.text });
      }
      if (parsed.type === 'message_stop') break;
      if (parsed.type === 'message_delta' && parsed.message?.usage) {
        const u = parsed.message.usage;
        ctx.onChunk({ kind: 'usage', usage: { promptTokens: u.input_tokens, completionTokens: u.output_tokens, totalTokens: u.input_tokens + u.output_tokens } });
      }
    }
    ctx.onChunk({ kind: 'done' });
  }
}
