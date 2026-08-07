import { describe, it, expect } from 'vitest';
import { createAdapter } from './index';
import type { ChatRequest } from '../types';

/** CORE-16: parseSSE dispatches on blank lines; frame fixtures accordingly. */
function frameSSE(lines: string[]): string {
  if (lines.some(l => l === '')) return lines.join('\n') + '\n';
  const framed: string[] = [];
  let pending: string[] = [];
  const flush = () => {
    if (!pending.length) return;
    framed.push(...pending, '');
    pending = [];
  };
  for (const l of lines) {
    if (l.startsWith('data:') && pending.some(p => p.startsWith('data:'))) flush();
    else if (l.startsWith('event:') && pending.length) flush();
    pending.push(l);
  }
  flush();
  return framed.join('\n');
}

function mockFetch(lines: string[]) {
  const body = frameSSE(lines);
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
    const adapter = createAdapter('openai-compatible', { fetchImpl: fetchImpl as typeof fetch });
    const req: ChatRequest = {
      provider: { id: 'p1', name: 'p', type: 'openai-compatible', baseUrl: 'https://api.example.com', apiKeyRef: 'k', createdAt: '', updatedAt: '' },
      modelId: 'my-model', messages: [{ role: 'user', content: 'hi' }], stream: true,
      tools: [{ name: 'get_weather', description: 'weather', parameters: { type: 'object', properties: {} } }]
    };
    await adapter.chat(req, { apiKey: 'sk-test', onChunk: () => {} });
    expect((capturedBody as unknown as { tools?: Array<{ function: { name: string } }> }).tools?.[0]?.function?.name).toBe('get_weather');
  });

  it('serializes an assistant tool-call turn and links the tool result by tool_call_id', async () => {
    let capturedBody: { messages?: Array<Record<string, unknown>> } | null = null;
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return (await mockFetch(['data: [DONE]'])()) as unknown as Response;
    };
    const adapter = createAdapter('openai-compatible', { fetchImpl: fetchImpl as typeof fetch });
    const req: ChatRequest = {
      provider: { id: 'p1', name: 'p', type: 'openai-compatible', baseUrl: 'https://api.example.com', apiKeyRef: 'k', createdAt: '', updatedAt: '' },
      modelId: 'my-model', stream: true,
      messages: [
        { role: 'user', content: 'weather in SF?' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'get_weather', arguments: { city: 'SF' } }] },
        { role: 'tool', content: '18C', toolCallId: 'call_1', name: 'get_weather' }
      ]
    };
    await adapter.chat(req, { apiKey: 'sk-test', onChunk: () => {} });
    const messages = capturedBody!.messages!;
    expect(messages[1]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"SF"}' } }]
    });
    expect(messages[2]).toEqual({ role: 'tool', content: '18C', name: 'get_weather', tool_call_id: 'call_1' });
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

  it('emits error chunk and argumentsParseError for truncated tool JSON (CORE-03)', async () => {
    const adapter = createAdapter('openai-compatible', { fetchImpl: mockFetch([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_weather","arguments":"{\\"city\\":\\"SF"}}]}}]}',
      'data: [DONE]'
    ]) });
    const req: ChatRequest = {
      provider: { id: 'p1', name: 'p', type: 'openai-compatible', baseUrl: 'https://api.example.com', apiKeyRef: 'k', createdAt: '', updatedAt: '' },
      modelId: 'my-model', messages: [{ role: 'user', content: 'hi' }], stream: true
    };
    const errors: string[] = [];
    const calls: Array<{ id: string; name: string; arguments: Record<string, unknown>; argumentsParseError?: string }> = [];
    await adapter.chat(req, {
      apiKey: 'sk-test',
      onChunk: (c) => {
        if (c.kind === 'error') errors.push(c.error);
        if (c.kind === 'tool_call') calls.push(...c.toolCalls);
      }
    });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('invalid tool arguments for get_weather');
    expect(calls).toHaveLength(1);
    expect(calls[0].argumentsParseError).toBeTruthy();
    expect(calls[0].arguments).toEqual({});
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

  it('maps an assistant tool-call turn to tool_use and the tool results to one user tool_result message', async () => {
    let capturedBody: { messages?: Array<{ role: string; content: unknown }> } | null = null;
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return (await mockFetch(['event: message_stop', 'data: {"type":"message_stop"}'])()) as unknown as Response;
    };
    const adapter = createAdapter('anthropic-compatible', { fetchImpl: fetchImpl as typeof fetch });
    const req: ChatRequest = {
      provider: { id: 'p1', name: 'p', type: 'anthropic-compatible', baseUrl: 'https://api.example.com', apiKeyRef: 'k', createdAt: '', updatedAt: '' },
      modelId: 'my-model', stream: true,
      messages: [
        { role: 'user', content: 'weather in SF and NY?' },
        { role: 'assistant', content: 'checking', toolCalls: [
          { id: 'toolu_1', name: 'get_weather', arguments: { city: 'SF' } },
          { id: 'toolu_2', name: 'get_weather', arguments: { city: 'NY' } }
        ] },
        { role: 'tool', content: '18C', toolCallId: 'toolu_1', name: 'get_weather' },
        { role: 'tool', content: '24C', toolCallId: 'toolu_2', name: 'get_weather' }
      ]
    };
    await adapter.chat(req, { apiKey: 'sk-ant-test', onChunk: () => {} });
    const messages = capturedBody!.messages!;
    // No `tool` role survives, and the two results share ONE user message so the
    // user/assistant alternation Anthropic requires holds.
    expect(messages.map(m => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[1].content).toEqual([
      { type: 'text', text: 'checking' },
      { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'SF' } },
      { type: 'tool_use', id: 'toolu_2', name: 'get_weather', input: { city: 'NY' } }
    ]);
    expect(messages[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_1', content: '18C' },
      { type: 'tool_result', tool_use_id: 'toolu_2', content: '24C' }
    ]);
  });

  it('omits the text block when a tool-only assistant turn has no text', async () => {
    let capturedBody: { messages?: Array<{ role: string; content: unknown }> } | null = null;
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return (await mockFetch(['event: message_stop', 'data: {"type":"message_stop"}'])()) as unknown as Response;
    };
    const adapter = createAdapter('anthropic-compatible', { fetchImpl: fetchImpl as typeof fetch });
    const req: ChatRequest = {
      provider: { id: 'p1', name: 'p', type: 'anthropic-compatible', baseUrl: 'https://api.example.com', apiKeyRef: 'k', createdAt: '', updatedAt: '' },
      modelId: 'my-model', stream: true,
      messages: [
        { role: 'user', content: 'go' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'toolu_1', name: 'ls', arguments: {} }] }
      ]
    };
    await adapter.chat(req, { apiKey: 'sk-ant-test', onChunk: () => {} });
    expect(capturedBody!.messages![1].content).toEqual([{ type: 'tool_use', id: 'toolu_1', name: 'ls', input: {} }]);
  });

  it('parses a streamed tool_use block with input_json_delta fragments into a tool_call chunk', async () => {
    const adapter = createAdapter('anthropic-compatible', { fetchImpl: mockFetch([
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Let me check"}}',
      '',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":0}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"get_weather","input":{}}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"SF\\"}"}}',
      '',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":1}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":9}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}'
    ]) });
    const req: ChatRequest = {
      provider: { id: 'p1', name: 'p', type: 'anthropic-compatible', baseUrl: 'https://api.example.com', apiKeyRef: 'k', createdAt: '', updatedAt: '' },
      modelId: 'my-model', messages: [{ role: 'user', content: 'hi' }], stream: true
    };
    const text: string[] = [];
    const calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
    await adapter.chat(req, { apiKey: 'sk-ant-test', onChunk: (c) => {
      if (c.kind === 'delta') text.push(c.delta);
      if (c.kind === 'tool_call') calls.push(...c.toolCalls);
    } });
    expect(text.join('')).toBe('Let me check');
    expect(calls).toEqual([{ id: 'toolu_1', name: 'get_weather', arguments: { city: 'SF' } }]);
  });

  it('emits error chunk and argumentsParseError for truncated input_json (CORE-03)', async () => {
    const adapter = createAdapter('anthropic-compatible', { fetchImpl: mockFetch([
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"get_weather","input":{}}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":"}}',
      '',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":0}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}'
    ]) });
    const req: ChatRequest = {
      provider: { id: 'p1', name: 'p', type: 'anthropic-compatible', baseUrl: 'https://api.example.com', apiKeyRef: 'k', createdAt: '', updatedAt: '' },
      modelId: 'my-model', messages: [{ role: 'user', content: 'hi' }], stream: true
    };
    const errors: string[] = [];
    const calls: Array<{ argumentsParseError?: string; arguments: Record<string, unknown> }> = [];
    await adapter.chat(req, {
      apiKey: 'sk-ant-test',
      onChunk: (c) => {
        if (c.kind === 'error') errors.push(c.error);
        if (c.kind === 'tool_call') calls.push(...c.toolCalls);
      }
    });
    expect(errors.length).toBe(1);
    expect(calls[0].argumentsParseError).toBeTruthy();
    expect(calls[0].arguments).toEqual({});
  });

  it('emits a tool_use call whose content_block_stop never arrives', async () => {
    const adapter = createAdapter('anthropic-compatible', { fetchImpl: mockFetch([
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_9","name":"ls","input":{}}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}'
    ]) });
    const req: ChatRequest = {
      provider: { id: 'p1', name: 'p', type: 'anthropic-compatible', baseUrl: 'https://api.example.com', apiKeyRef: 'k', createdAt: '', updatedAt: '' },
      modelId: 'my-model', messages: [{ role: 'user', content: 'hi' }], stream: true
    };
    const calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
    await adapter.chat(req, { apiKey: 'sk-ant-test', onChunk: (c) => { if (c.kind === 'tool_call') calls.push(...c.toolCalls); } });
    expect(calls).toEqual([{ id: 'toolu_9', name: 'ls', arguments: {} }]);
  });
});

describe('adapter SafeHttpClient (CORE-18)', () => {
  it('routes chat through http.request and surfaces SSRF denial', async () => {
    const http = {
      request: async () => {
        throw new Error('URL_PRIVATE_ADDRESS');
      },
    };
    const adapter = createAdapter('openai-compatible', { http });
    const req: ChatRequest = {
      provider: { id: 'p1', name: 'p', type: 'openai-compatible', baseUrl: 'https://169.254.169.254', apiKeyRef: 'k', createdAt: '', updatedAt: '' },
      modelId: 'my-model', messages: [{ role: 'user', content: 'hi' }], stream: true,
    };
    await expect(adapter.chat(req, { apiKey: 'sk', onChunk: () => {} })).rejects.toThrow('URL_PRIVATE_ADDRESS');
  });
});

