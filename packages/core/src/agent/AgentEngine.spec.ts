import { describe, it, expect } from 'vitest';
import { AgentEngine } from './AgentEngine';
import { ToolRegistry } from './ToolRegistry';
import type { ChatChunk } from '../model/types';
import type { AgentConfig } from '@jarvis/protocol';

function fakeChat(script: Array<() => void> | (() => void)) {
  let chatCount = 0;
  const runScript = () => { if (Array.isArray(script)) { for (const s of script) s(); } else { script(); } };
  return async (_req: unknown, opts: { apiKey: string; signal?: AbortSignal; onChunk?: (c: ChatChunk) => void }) => {
    chatCount++;
    runScript();
    if (chatCount === 1) {
      // First chat call: emit a tool_call chunk (the REACT loop executes the tool).
      opts.onChunk?.({ kind: 'tool_call', toolCalls: [{ id: 't1', name: 'echo', arguments: { text: 'a' } }] });
      opts.onChunk?.({ kind: 'done' });
      return { text: '', usage: null };
    }
    // Subsequent calls: emit a final text chunk and NO tool_call, so the loop completes.
    opts.onChunk?.({ kind: 'delta', delta: 'done' });
    opts.onChunk?.({ kind: 'done' });
    return { text: 'done', usage: null };
  };
}

const agent: AgentConfig = { id: 'a1', name: 'A', slug: 'a', description: '', systemPrompt: 'be terse', modelId: 'm1', workspaceId: null, contextBudgetTokens: 1000, planOnly: false, createdAt: '', updatedAt: '' };

describe('AgentEngine', () => {
  it('executes tool calls then completes', async () => {
    const reg = new ToolRegistry();
    const seen: string[] = [];
    reg.register({ name: 'echo', description: '', parameters: {} }, async (args) => { seen.push(String(args.text)); return { ok: true, output: String(args.text) }; });
    const engine = new AgentEngine({ modelRouter: { chat: fakeChat([]) }, toolRegistry: reg, maxSteps: 3 });
    const result = await engine.run({ agent, messages: [{ role: 'user', content: 'go' }], cwd: '/tmp', env: {}, apiKey: 'sk', provider: { type: 'openai-compatible', baseUrl: 'https://x.com' }, modelId: 'm1' });
    expect(seen).toEqual(['a']);
    expect(result.toolCalls).toBe(1);
  });

  it('stops at maxSteps', async () => {
    const reg = new ToolRegistry();
    reg.register({ name: 'echo', description: '', parameters: {} }, async () => ({ ok: true, output: 'x' }));
    let calls = 0;
    const engine = new AgentEngine({ modelRouter: { chat: fakeChat(() => { calls++; }) }, toolRegistry: reg, maxSteps: 2 });
    const result = await engine.run({ agent, messages: [{ role: 'user', content: 'go' }], cwd: '/', env: {}, apiKey: 'sk', provider: { type: 'openai-compatible', baseUrl: 'https://x.com' }, modelId: 'm1' });
    expect(calls).toBeLessThanOrEqual(2);
    expect(result.toolCalls).toBeLessThanOrEqual(2);
  });

  it('terminates exactly at maxSteps when the model requests a tool call on every step', async () => {
    const reg = new ToolRegistry();
    reg.register({ name: 'echo', description: '', parameters: {} }, async () => ({ ok: true, output: 'x' }));
    let calls = 0;
    const maxSteps = 3;
    const alwaysToolChat = async (_req: unknown, opts: { apiKey: string; signal?: AbortSignal; onChunk?: (c: ChatChunk) => void }) => {
      calls++;
      // Every step requests another tool call, so only the loop cap stops it.
      opts.onChunk?.({ kind: 'tool_call', toolCalls: [{ id: `t${calls}`, name: 'echo', arguments: { text: 'a' } }] });
      opts.onChunk?.({ kind: 'done' });
      return { text: '', usage: null };
    };
    const engine = new AgentEngine({ modelRouter: { chat: alwaysToolChat }, toolRegistry: reg, maxSteps });
    const result = await engine.run({ agent, messages: [{ role: 'user', content: 'go' }], cwd: '/', env: {}, apiKey: 'sk', provider: { type: 'openai-compatible', baseUrl: 'https://x.com' }, modelId: 'm1' });
    expect(calls).toBe(maxSteps);
    expect(result.toolCalls).toBe(maxSteps);
  });

  it('records the tool-call assistant turn and the result id even when the model sent no text', async () => {
    const reg = new ToolRegistry();
    reg.register({ name: 'echo', description: '', parameters: {} }, async (args) => ({ ok: true, output: `out:${String(args.text)}` }));
    const seen: Array<Array<{ role: string; content: unknown; toolCalls?: unknown; toolCallId?: string }>> = [];
    const chat = async (req: { messages: Array<{ role: string; content: unknown; toolCalls?: unknown; toolCallId?: string }> }, opts: { onChunk?: (c: ChatChunk) => void }) => {
      seen.push(req.messages);
      if (seen.length === 1) {
        opts.onChunk?.({ kind: 'tool_call', toolCalls: [{ id: 'call_1', name: 'echo', arguments: { text: 'a' } }] });
        opts.onChunk?.({ kind: 'done' });
        return { text: '', usage: null };
      }
      opts.onChunk?.({ kind: 'done' });
      return { text: 'ok', usage: null };
    };
    const engine = new AgentEngine({ modelRouter: { chat }, toolRegistry: reg, maxSteps: 3 });
    await engine.run({ agent, messages: [{ role: 'user', content: 'go' }], cwd: '/tmp', env: {}, apiKey: 'sk', provider: { type: 'openai-compatible', baseUrl: 'https://x.com' }, modelId: 'm1' });
    expect(seen[1]).toEqual([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'echo', arguments: { text: 'a' } }] },
      { role: 'tool', content: 'out:a', toolCallId: 'call_1', name: 'echo' }
    ]);
  });

  it('gives an id-less tool call a synthetic id shared by the call and its result', async () => {
    const reg = new ToolRegistry();
    reg.register({ name: 'echo', description: '', parameters: {} }, async () => ({ ok: true, output: 'x' }));
    const seen: Array<Array<{ role: string; toolCalls?: Array<{ id: string }>; toolCallId?: string }>> = [];
    const chat = async (req: { messages: Array<{ role: string; toolCalls?: Array<{ id: string }>; toolCallId?: string }> }, opts: { onChunk?: (c: ChatChunk) => void }) => {
      seen.push(req.messages);
      if (seen.length === 1) {
        opts.onChunk?.({ kind: 'tool_call', toolCalls: [{ id: '', name: 'echo', arguments: {} }] });
        opts.onChunk?.({ kind: 'done' });
        return { text: '', usage: null };
      }
      opts.onChunk?.({ kind: 'done' });
      return { text: 'ok', usage: null };
    };
    const engine = new AgentEngine({ modelRouter: { chat }, toolRegistry: reg, maxSteps: 2 });
    await engine.run({ agent, messages: [{ role: 'user', content: 'go' }], cwd: '/tmp', env: {}, apiKey: 'sk', provider: { type: 'openai-compatible', baseUrl: 'https://x.com' }, modelId: 'm1' });
    const assistantId = seen[1][1].toolCalls![0].id;
    expect(assistantId).toBeTruthy();
    expect(seen[1][2].toolCallId).toBe(assistantId);
  });

  it('links a denied tool call to its result so the transcript stays well-formed', async () => {
    const reg = new ToolRegistry();
    reg.register({ name: 'echo', description: '', parameters: {} }, async () => ({ ok: true, output: 'x' }));
    const seen: Array<Array<{ role: string; content: unknown; toolCallId?: string }>> = [];
    const chat = async (req: { messages: Array<{ role: string; content: unknown; toolCallId?: string }> }, opts: { onChunk?: (c: ChatChunk) => void }) => {
      seen.push(req.messages);
      if (seen.length === 1) {
        opts.onChunk?.({ kind: 'tool_call', toolCalls: [{ id: 'call_9', name: 'echo', arguments: {} }] });
        opts.onChunk?.({ kind: 'done' });
        return { text: '', usage: null };
      }
      opts.onChunk?.({ kind: 'done' });
      return { text: 'ok', usage: null };
    };
    const engine = new AgentEngine({ modelRouter: { chat }, toolRegistry: reg, maxSteps: 2, approvalGate: async () => false });
    await engine.run({ agent, messages: [{ role: 'user', content: 'go' }], cwd: '/tmp', env: {}, apiKey: 'sk', provider: { type: 'openai-compatible', baseUrl: 'https://x.com' }, modelId: 'm1' });
    expect(seen[1][2]).toMatchObject({ role: 'tool', content: '[denied] echo', toolCallId: 'call_9' });
  });

  it('does not execute a tool call with argumentsParseError and feeds the error to the model (CORE-03)', async () => {
    const reg = new ToolRegistry();
    let executed = 0;
    reg.register({ name: 'echo', description: '', parameters: {} }, async () => { executed++; return { ok: true, output: 'ran' }; });
    const seen: Array<Array<{ role: string; content: unknown; toolCallId?: string }>> = [];
    const chat = async (req: { messages: Array<{ role: string; content: unknown; toolCallId?: string }> }, opts: { onChunk?: (c: ChatChunk) => void }) => {
      seen.push(req.messages);
      if (seen.length === 1) {
        opts.onChunk?.({ kind: 'error', error: 'invalid tool arguments for echo: Unexpected end of JSON' });
        opts.onChunk?.({ kind: 'tool_call', toolCalls: [{ id: 'call_bad', name: 'echo', arguments: {}, argumentsParseError: 'Unexpected end of JSON' }] });
        opts.onChunk?.({ kind: 'done' });
        return { text: '', usage: null };
      }
      opts.onChunk?.({ kind: 'done' });
      return { text: 'ok', usage: null };
    };
    const engine = new AgentEngine({ modelRouter: { chat }, toolRegistry: reg, maxSteps: 2 });
    await engine.run({ agent, messages: [{ role: 'user', content: 'go' }], cwd: '/tmp', env: {}, apiKey: 'sk', provider: { type: 'openai-compatible', baseUrl: 'https://x.com' }, modelId: 'm1' });
    expect(executed).toBe(0);
    expect(seen[1][2]).toMatchObject({ role: 'tool', toolCallId: 'call_bad', content: '[invalid arguments] Unexpected end of JSON' });
  });

  it('passes registered tools to the model router', async () => {
    const reg = new ToolRegistry();
    reg.register({ name: 'echo', description: 'echo', parameters: {} }, async () => ({ ok: true, output: 'x' }));
    let captured: { tools?: Array<{ name: string }> } | null = null;
    const chat = async (req: { tools?: Array<{ name: string }> }, opts: { onChunk?: (c: ChatChunk) => void }) => {
      captured = req;
      opts.onChunk?.({ kind: 'delta', delta: 'ok' });
      opts.onChunk?.({ kind: 'done' });
      return { text: 'ok', usage: null };
    };
    const engine = new AgentEngine({ modelRouter: { chat }, toolRegistry: reg, maxSteps: 1 });
    await engine.run({ agent, messages: [{ role: 'user', content: 'go' }], cwd: '/tmp', env: {}, apiKey: 'sk', provider: { type: 'openai-compatible', baseUrl: 'https://x.com' }, modelId: 'm1' });
    expect(captured!.tools?.map((t: { name: string }) => t.name)).toEqual(['echo']);
  });
});
