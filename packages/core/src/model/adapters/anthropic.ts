import type { ChatRequest, ChatChunk, ModelMessage, ProviderAdapter } from '../types';
import type { SafeHttpClient } from '../../network/SafeHttpClient';
import { parseSSE } from '../../util/sse';
import { normalizeContent } from '../../office/content';
import { emitToolCall } from '../parseToolArguments';

interface AnthropicMessage { role: 'user' | 'assistant'; content: unknown }

export interface AnthropicAdapterDeps {
  fetchImpl?: typeof fetch;
  /** CORE-18: SSRF-safe client preferred over bare fetch for production chat. */
  http?: SafeHttpClient;
}

const CHAT_FETCH_LIMITS = {
  timeoutMs: 120_000,
  maxRedirects: 3,
  maxResponseBytes: 50 * 1024 * 1024,
};

export class AnthropicAdapter implements ProviderAdapter {
  readonly type = 'anthropic-compatible' as const;
  constructor(private deps: AnthropicAdapterDeps = {}) {}

  async chat(req: ChatRequest, ctx: { apiKey: string; onChunk: (c: ChatChunk) => void; signal?: AbortSignal }): Promise<void> {
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
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ctx.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: ctx.signal,
    };
    const res = this.deps.http
      ? await this.deps.http.request(url, init, { ...CHAT_FETCH_LIMITS, signal: ctx.signal })
      : await (this.deps.fetchImpl ?? fetch)(url, init);
    if (!res.ok) throw new Error(`anthropic http ${res.status}: ${await res.text()}`);
    let inputTokens = 0;
    // CORE-02: tool_use arrives as its own content block — the id/name land in
    // content_block_start and the arguments stream in as input_json_delta
    // fragments, keyed by block index.
    const toolBlocks = new Map<number, { id: string; name: string; json: string }>();
    const emitParsedToolCall = (acc: { id: string; name: string; json: string }) => {
      // CORE-03: truncated/invalid input_json must not collapse to `{}`.
      emitToolCall(ctx.onChunk, acc.id, acc.name, acc.json);
    };
    for await (const data of parseSSE(res.body)) {
      const parsed = JSON.parse(data) as {
        type?: string;
        index?: number;
        content_block?: { type?: string; id?: string; name?: string };
        delta?: { type?: string; text?: string; partial_json?: string };
        message?: { usage?: { input_tokens?: number } };
        usage?: { output_tokens?: number };
      };
      if (parsed.type === 'message_start' && parsed.message?.usage?.input_tokens !== undefined) {
        inputTokens = parsed.message.usage.input_tokens;
      }
      if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
        toolBlocks.set(parsed.index ?? 0, { id: parsed.content_block.id ?? '', name: parsed.content_block.name ?? '', json: '' });
      }
      if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta' && parsed.delta.text) {
        ctx.onChunk({ kind: 'delta', delta: parsed.delta.text });
      }
      if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'input_json_delta' && parsed.delta.partial_json) {
        const acc = toolBlocks.get(parsed.index ?? 0);
        if (acc) acc.json += parsed.delta.partial_json;
      }
      if (parsed.type === 'content_block_stop') {
        const idx = parsed.index ?? 0;
        const acc = toolBlocks.get(idx);
        if (acc) { toolBlocks.delete(idx); emitParsedToolCall(acc); }
      }
      if (parsed.type === 'message_stop') break;
      if (parsed.type === 'message_delta' && parsed.usage?.output_tokens !== undefined) {
        const outputTokens = parsed.usage.output_tokens;
        ctx.onChunk({ kind: 'usage', usage: { promptTokens: inputTokens, completionTokens: outputTokens, totalTokens: inputTokens + outputTokens } });
      }
    }
    // A stream cut short after message_stop (or without the block's stop event)
    // must not swallow the call the model already fully described.
    for (const acc of toolBlocks.values()) emitParsedToolCall(acc);
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

