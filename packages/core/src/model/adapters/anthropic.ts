import type { ChatRequest, ChatChunk, ModelMessage, ProviderAdapter } from '../types';
import { parseSSE } from '../../util/sse';
import { normalizeContent } from '../../office/content';

interface AnthropicMessage { role: 'user' | 'assistant'; content: unknown }

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
    const rest = toAnthropicMessages(req.messages);
    const body = {
      model: req.modelId,
      max_tokens: req.maxTokens ?? 4096,
      system: system || undefined,
      messages: rest,
      stream: true,
      ...(req.tools && req.tools.length > 0 ? {
        tools: req.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })),
        tool_choice: req.toolChoice === 'none' ? { type: 'none' } : { type: 'auto' }
      } : {})
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

// CORE-01: Anthropic has no `tool` role. An assistant turn's tool calls become
// tool_use blocks and each tool result becomes a tool_result block inside the
// FOLLOWING user message — and since the API requires alternating roles, all
// results of one turn must be merged into that single user message.
function toAnthropicMessages(messages: ModelMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId ?? '', content: toolResultContent(m.content) };
      const prev = out[out.length - 1];
      if (prev && prev.role === 'user' && isToolResultBlocks(prev.content)) prev.content.push(block);
      else out.push({ role: 'user', content: [block] });
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      const blocks: unknown[] = [...textBlocks(m.content)];
      for (const c of m.toolCalls) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments ?? {} });
      out.push({ role: 'assistant', content: blocks });
      continue;
    }
    // L23: normalize each message — image_url parts map to Anthropic image
    // content blocks, string content passes through unchanged.
    out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: normalizeContent(m.content, 'anthropic') });
  }
  return out;
}

function isToolResultBlocks(content: unknown): content is unknown[] {
  return Array.isArray(content) && content.every(b => (b as { type?: string } | null)?.type === 'tool_result');
}

function textBlocks(content: ModelMessage['content']): unknown[] {
  const normalized = normalizeContent(content, 'anthropic');
  // An assistant turn that only requested tools has no text, and Anthropic
  // rejects an empty text block.
  if (typeof normalized === 'string') return normalized ? [{ type: 'text', text: normalized }] : [];
  return Array.isArray(normalized) ? normalized : [];
}

function toolResultContent(content: ModelMessage['content']): unknown {
  if (typeof content === 'string') return content || '(no output)';
  const normalized = normalizeContent(content, 'anthropic');
  return Array.isArray(normalized) && normalized.length > 0 ? normalized : '(no output)';
}
