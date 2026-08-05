import type { ChatRequest, ChatChunk, ProviderAdapter } from '../types';
import { parseSSE } from '../../util/sse';
import { normalizeContent } from '../../office/content';

export class AnthropicAdapter implements ProviderAdapter {
  readonly type = 'anthropic-compatible' as const;
  constructor(private deps: { fetchImpl?: typeof fetch } = {}) {}

  async chat(req: ChatRequest, ctx: { apiKey: string; onChunk: (c: ChatChunk) => void; signal?: AbortSignal }): Promise<void> {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const url = `${req.provider.baseUrl.replace(/\/$/, '')}/v1/messages`;
    // System messages are always plain strings in practice; if one ever carries a
    // content array, join only its text parts (image blocks are not valid in the
    // Anthropic `system` field).
    const system = req.messages.filter(m => m.role === 'system').map(m => typeof m.content === 'string' ? m.content : m.content.filter(p => p.type === 'text').map(p => p.text).join('\n')).join('\n');
    // L23: normalize each message — image_url parts map to Anthropic image
    // content blocks, string content passes through unchanged.
    const rest = req.messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: normalizeContent(m.content, 'anthropic') }));
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
    let inputTokens = 0;
    for await (const data of parseSSE(res.body)) {
      const parsed = JSON.parse(data) as { type?: string; delta?: { type?: string; text?: string }; message?: { usage?: { input_tokens?: number } }; usage?: { output_tokens?: number } };
      if (parsed.type === 'message_start' && parsed.message?.usage?.input_tokens !== undefined) {
        inputTokens = parsed.message.usage.input_tokens;
      }
      if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta' && parsed.delta.text) {
        ctx.onChunk({ kind: 'delta', delta: parsed.delta.text });
      }
      if (parsed.type === 'message_stop') break;
      if (parsed.type === 'message_delta' && parsed.usage?.output_tokens !== undefined) {
        const outputTokens = parsed.usage.output_tokens;
        ctx.onChunk({ kind: 'usage', usage: { promptTokens: inputTokens, completionTokens: outputTokens, totalTokens: inputTokens + outputTokens } });
      }
    }
    ctx.onChunk({ kind: 'done' });
  }
}
