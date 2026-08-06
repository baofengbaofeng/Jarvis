import { describe, it, expect } from 'vitest';
import { createAdapter } from './index';
import type { ChatRequest } from '../types';

function mockFetch(lines: string[]) {
  const body = lines.join('\n') + '\n';
  return async () => ({ ok: true, status: 200, body: new ReadableStream({
    start(c) {
      const enc = new TextEncoder();
      c.enqueue(enc.encode(body));
      c.close();
    }
  }) }) as unknown as Response;
}

describe('openai adapter', () => {
  it('streams deltas and done', async () => {
    const adapter = createAdapter('openai-compatible', { fetchImpl: mockFetch([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}',
      'data: {"choices":[{"delta":{"content":"lo"}}]}',
      'data: [DONE]'
    ]) });
    const chunks: string[] = [];
    const req: ChatRequest = {
      provider: { id: 'p1', name: 'p', type: 'openai-compatible', baseUrl: 'https://api.example.com', apiKeyRef: 'k', createdAt: '', updatedAt: '' },
      modelId: 'my-model', messages: [{ role: 'user', content: 'hi' }], stream: true
    };
    await adapter.chat(req, { apiKey: 'sk-test', onChunk: (c) => { if (c.kind === 'delta') chunks.push(c.delta); } });
    expect(chunks.join('')).toBe('Hello');
  });

  it('includes tools in the OpenAI request body when provided', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return (await mockFetch(['data: [DONE]'])()) as unknown as Response;
    };
    const adapter = createAdapter('openai-compatible', { fetchImpl });
    const req: ChatRequest = {
      provider: { id: 'p1', name: 'p', type: 'openai-compatible', baseUrl: 'https://api.example.com', apiKeyRef: 'k', createdAt: '', updatedAt: '' },
      modelId: 'my-model', messages: [{ role: 'user', content: 'hi' }], stream: true,
      tools: [{ name: 'get_weather', description: 'weather', parameters: { type: 'object', properties: {} } }]
    };
    await adapter.chat(req, { apiKey: 'sk-test', onChunk: () => {} });
    expect((capturedBody as { tools?: Array<{ function: { name: string } }> }).tools?.[0]?.function?.name).toBe('get_weather');
  });

  it('accumulates multi-delta tool calls into one well-formed chunk', async () => {
    const adapter = createAdapter('openai-compatible', { fetchImpl: mockFetch([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_weather","arguments":""}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\":\\"SF"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"}"}}]}}]}',
      'data: [DONE]'
    ]) });
    const req: ChatRequest = {
      provider: { id: 'p1', name: 'p', type: 'openai-compatible', baseUrl: 'https://api.example.com', apiKeyRef: 'k', createdAt: '', updatedAt: '' },
      modelId: 'my-model', messages: [{ role: 'user', content: 'hi' }], stream: true
    };
    const calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
    await adapter.chat(req, { apiKey: 'sk-test', onChunk: (c) => { if (c.kind === 'tool_call') calls.push(...c.toolCalls); } });
    expect(calls).toEqual([{ id: 'call_1', name: 'get_weather', arguments: { city: 'SF' } }]);
  });
});

describe('anthropic adapter', () => {
  it('streams text deltas', async () => {
    const adapter = createAdapter('anthropic-compatible', { fetchImpl: mockFetch([
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}'
    ]) });
    const chunks: string[] = [];
    const req: ChatRequest = {
      provider: { id: 'p1', name: 'p', type: 'anthropic-compatible', baseUrl: 'https://api.example.com', apiKeyRef: 'k', createdAt: '', updatedAt: '' },
      modelId: 'my-model', messages: [{ role: 'user', content: 'hi' }], stream: true
    };
    await adapter.chat(req, { apiKey: 'sk-ant-test', onChunk: (c) => { if (c.kind === 'delta') chunks.push(c.delta); } });
    expect(chunks.join('')).toBe('Hi');
  });

  it('emits usage from message_start input tokens and message_delta output tokens', async () => {
    const adapter = createAdapter('anthropic-compatible', { fetchImpl: mockFetch([
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":0}}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}'
    ]) });
    const req: ChatRequest = {
      provider: { id: 'p1', name: 'p', type: 'anthropic-compatible', baseUrl: 'https://api.example.com', apiKeyRef: 'k', createdAt: '', updatedAt: '' },
      modelId: 'my-model', messages: [{ role: 'user', content: 'hi' }], stream: true
    };
    const usageChunks: Array<{ promptTokens: number; completionTokens: number; totalTokens: number }> = [];
    await adapter.chat(req, { apiKey: 'sk-ant-test', onChunk: (c) => { if (c.kind === 'usage') usageChunks.push(c.usage); } });
    expect(usageChunks).toEqual([{ promptTokens: 5, completionTokens: 2, totalTokens: 7 }]);
  });
});
