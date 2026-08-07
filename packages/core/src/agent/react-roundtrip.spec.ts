import { describe, it, expect } from 'vitest';
import { AgentEngine } from './AgentEngine';
import { ToolRegistry } from './ToolRegistry';
import { ModelRouter } from '../model/router';
import { createAdapter } from '../model/adapters/index';
import type { AgentConfig } from '@jarvis/protocol';

// CORE-01/CORE-02: the REACT loop's second request is built by the REAL adapters
// here (no fake chat), so these specs fail if the tool round trip is not
// representable on the wire — the exact shape a live provider validates.

const agent: AgentConfig = { id: 'a1', name: 'A', slug: 'a', description: '', systemPrompt: '', modelId: 'm1', workspaceId: null, contextBudgetTokens: 1000, planOnly: false, createdAt: '', updatedAt: '' };

/** CORE-16: blank-line-delimited SSE; auto-frame consecutive data: lines. */
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

function sseResponse(lines: string[]): Response {
  return { ok: true, status: 200, body: new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(frameSSE(lines))); c.close(); }
  }) } as unknown as Response;
}

// Streams the scripted turns in order and records every request body, so a spec
// can assert what the SECOND round trip actually sent.
function scriptedFetch(turns: string[][]): { fetchImpl: typeof fetch; bodies: Array<Record<string, unknown>> } {
  const bodies: Array<Record<string, unknown>> = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return sseResponse(turns[Math.min(bodies.length - 1, turns.length - 1)]);
  }) as unknown as typeof fetch;
  return { fetchImpl, bodies };
}

function buildEngine(fetchImpl: typeof fetch): AgentEngine {
  const reg = new ToolRegistry();
  reg.register({ name: 'get_weather', description: 'weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } },
    async (args) => ({ ok: true, output: `18C in ${String(args.city)}` }));
  const router = new ModelRouter({ createAdapter: (t) => createAdapter(t, { fetchImpl }) });
  return new AgentEngine({
    modelRouter: { chat: (req, opts) => router.chat(req, { apiKeyResolver: async () => 'sk-test', onChunk: opts.onChunk }) },
    toolRegistry: reg,
    maxSteps: 3
  });
}

const run = (engine: AgentEngine, type: 'openai-compatible' | 'anthropic-compatible') => engine.run({
  agent,
  messages: [{ role: 'user', content: 'weather in SF?' }],
  cwd: '/tmp', env: {}, apiKey: 'sk-test',
  provider: { type, baseUrl: 'https://api.example.com' },
  modelId: 'm1'
});

describe('REACT tool round trip on the OpenAI wire format', () => {
  it('sends the assistant tool_calls turn and the tool result linked by tool_call_id', async () => {
    const { fetchImpl, bodies } = scriptedFetch([
      [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc","function":{"name":"get_weather","arguments":"{\\"city\\":\\"SF\\"}"}}]}}]}',
        'data: [DONE]'
      ],
      ['data: {"choices":[{"delta":{"content":"It is 18C."}}]}', 'data: [DONE]']
    ]);
    const result = await run(buildEngine(fetchImpl), 'openai-compatible');

    expect(result.text).toBe('It is 18C.');
    expect(bodies).toHaveLength(2);
    const second = bodies[1] as { messages: Array<Record<string, unknown>> };
    expect(second.messages).toEqual([
      { role: 'user', content: 'weather in SF?' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_abc', type: 'function', function: { name: 'get_weather', arguments: '{"city":"SF"}' } }] },
      { role: 'tool', content: '18C in SF', name: 'get_weather', tool_call_id: 'call_abc' }
    ]);
  });
});

describe('REACT tool round trip on the Anthropic wire format', () => {
  it('parses the streamed tool_use block and replies with a linked tool_result', async () => {
    const { fetchImpl, bodies } = scriptedFetch([
      [
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_abc","name":"get_weather","input":{}}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":\\"SF\\"}"}}',
        '',
        'event: content_block_stop',
        'data: {"type":"content_block_stop","index":0}',
        '',
        'event: message_stop',
        'data: {"type":"message_stop"}'
      ],
      [
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"It is 18C."}}',
        '',
        'event: message_stop',
        'data: {"type":"message_stop"}'
      ]
    ]);
    const result = await run(buildEngine(fetchImpl), 'anthropic-compatible');

    expect(result.text).toBe('It is 18C.');
    expect(result.toolCalls).toBe(1);
    expect(bodies).toHaveLength(2);
    const second = bodies[1] as { messages: Array<{ role: string; content: unknown }> };
    expect(second.messages).toEqual([
      { role: 'user', content: 'weather in SF?' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_abc', name: 'get_weather', input: { city: 'SF' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_abc', content: '18C in SF' }] }
    ]);
  });
});
