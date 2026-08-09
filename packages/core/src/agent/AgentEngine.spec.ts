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

  it('accumulates usage across REACT steps instead of overwriting (CORE-05)', async () => {
    const reg = new ToolRegistry();
    reg.register({ name: 'echo', description: '', parameters: {} }, async () => ({ ok: true, output: 'x' }));
    let step = 0;
    const chat = async (_req: unknown, opts: { onChunk?: (c: ChatChunk) => void }) => {
      step++;
      if (step === 1) {
        opts.onChunk?.({ kind: 'tool_call', toolCalls: [{ id: 't1', name: 'echo', arguments: {} }] });
        opts.onChunk?.({ kind: 'usage', usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 } });
        opts.onChunk?.({ kind: 'done' });
        return { text: '', usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 } };
      }
      opts.onChunk?.({ kind: 'delta', delta: 'done' });
      opts.onChunk?.({ kind: 'usage', usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 } });
      opts.onChunk?.({ kind: 'done' });
      return { text: 'done', usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 } };
    };
    const engine = new AgentEngine({ modelRouter: { chat }, toolRegistry: reg, maxSteps: 3 });
    const result = await engine.run({ agent, messages: [{ role: 'user', content: 'go' }], cwd: '/tmp', env: {}, apiKey: 'sk', provider: { type: 'openai-compatible', baseUrl: 'https://x.com' }, modelId: 'm1' });
    expect(result.usage).toEqual({ promptTokens: 30, completionTokens: 7, totalTokens: 37 });
  });

  it('feeds a throwing tool handler back to the model as ok:false without killing the run (CORE-06)', async () => {
    const reg = new ToolRegistry();
    reg.register({ name: 'boom', description: '', parameters: {} }, async () => { throw new Error('handler failed'); });
    const seen: Array<Array<{ role: string; content: unknown; toolCallId?: string }>> = [];
    const chat = async (req: { messages: Array<{ role: string; content: unknown; toolCallId?: string }> }, opts: { onChunk?: (c: ChatChunk) => void }) => {
      seen.push(req.messages);
      if (seen.length === 1) {
        opts.onChunk?.({ kind: 'tool_call', toolCalls: [{ id: 'call_1', name: 'boom', arguments: {} }] });
        opts.onChunk?.({ kind: 'done' });
        return { text: '', usage: null };
      }
      opts.onChunk?.({ kind: 'done' });
      return { text: 'recovered', usage: null };
    };
    const engine = new AgentEngine({ modelRouter: { chat }, toolRegistry: reg, maxSteps: 2 });
    const result = await engine.run({ agent, messages: [{ role: 'user', content: 'go' }], cwd: '/tmp', env: {}, apiKey: 'sk', provider: { type: 'openai-compatible', baseUrl: 'https://x.com' }, modelId: 'm1' });
    expect(result.text).toBe('recovered');
    expect(seen[1][2]).toMatchObject({ role: 'tool', toolCallId: 'call_1', content: 'handler failed' });
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

  it('keeps distinct visibleTools per concurrent run (CORE-19)', async () => {
    const reg = new ToolRegistry();
    reg.register({ name: 'echo', description: '', parameters: {} }, async () => ({ ok: true, output: 'x' }));
    reg.register({ name: 'write_file', description: '', parameters: {} }, async () => ({ ok: true, output: 'x' }));
    const seen: string[][] = [];
    let releaseA!: () => void;
    let releaseB!: () => void;
    const gateA = new Promise<void>((r) => { releaseA = r; });
    const gateB = new Promise<void>((r) => { releaseB = r; });
    let chats = 0;
    const chat = async (req: { tools?: Array<{ name: string }> }, opts: { onChunk?: (c: ChatChunk) => void }) => {
      const n = ++chats;
      seen.push((req.tools ?? []).map(t => t.name).sort());
      if (n === 1) await gateA;
      else if (n === 2) await gateB;
      opts.onChunk?.({ kind: 'done' });
      return { text: 'ok', usage: null };
    };
    const engine = new AgentEngine({ modelRouter: { chat }, toolRegistry: reg, maxSteps: 1 });
    const runA = engine.run({
      agent, messages: [{ role: 'user', content: 'a' }], cwd: '/', env: {}, apiKey: 'sk',
      provider: { type: 'openai-compatible', baseUrl: 'https://x.com' }, modelId: 'm1',
      visibleTools: ['echo'],
    });
    const runB = engine.run({
      agent, messages: [{ role: 'user', content: 'b' }], cwd: '/', env: {}, apiKey: 'sk',
      provider: { type: 'openai-compatible', baseUrl: 'https://x.com' }, modelId: 'm1',
      visibleTools: ['write_file'],
    });
    await new Promise(r => setTimeout(r, 0));
    expect(seen).toHaveLength(2);
    releaseA();
    releaseB();
    await Promise.all([runA, runB]);
    expect(seen).toContainEqual(['echo']);
    expect(seen).toContainEqual(['write_file']);
  });

  it('applies run-scoped toolFilter for visibility and execute (CORE-20)', async () => {
    const reg = new ToolRegistry();
    const executed: string[] = [];
    reg.register({ name: 'echo', description: '', parameters: {} }, async () => {
      executed.push('echo');
      return { ok: true, output: 'echo-ok' };
    });
    reg.register({ name: 'mcp:fs:read', description: '', parameters: {} }, async () => {
      executed.push('mcp:fs:read');
      return { ok: true, output: 'secret' };
    });
    reg.register({ name: 'mcp:other:x', description: '', parameters: {} }, async () => {
      executed.push('mcp:other:x');
      return { ok: true, output: 'leaked' };
    });
    const seenTools: string[][] = [];
    let step = 0;
    const chat = async (req: { tools?: Array<{ name: string }> }, opts: { onChunk?: (c: ChatChunk) => void }) => {
      seenTools.push((req.tools ?? []).map(t => t.name).sort());
      step++;
      if (step === 1) {
        // Model tries an unbound MCP tool — must be denied without executing.
        opts.onChunk?.({ kind: 'tool_call', toolCalls: [{ id: '1', name: 'mcp:other:x', arguments: {} }] });
      } else {
        opts.onChunk?.({ kind: 'delta', delta: 'done' });
        opts.onChunk?.({ kind: 'done' });
      }
      return { text: step === 1 ? '' : 'done', usage: null };
    };
    const engine = new AgentEngine({ modelRouter: { chat }, toolRegistry: reg, maxSteps: 3 });
    const filter = (name: string) => !name.startsWith('mcp:') || name.startsWith('mcp:fs:');
    await engine.run({
      agent, messages: [{ role: 'user', content: 'go' }], cwd: '/', env: {}, apiKey: 'sk',
      provider: { type: 'openai-compatible', baseUrl: 'https://x.com' }, modelId: 'm1',
      toolFilter: filter,
    });
    expect(seenTools[0]).toEqual(['echo', 'mcp:fs:read']);
    expect(executed).not.toContain('mcp:other:x');
  });

  it('strips tools and notices when modelCapabilities.supportsTools is false', async () => {
    const reg = new ToolRegistry();
    reg.register({ name: 'echo', description: '', parameters: {} }, async () => ({ ok: true, output: 'x' }));
    const seen: Array<{ tools?: unknown; maxTokens?: number }> = [];
    const notices: string[] = [];
    const chat = async (req: { tools?: unknown; maxTokens?: number }, opts: { onChunk?: (c: ChatChunk) => void }) => {
      seen.push({ tools: req.tools, maxTokens: req.maxTokens });
      opts.onChunk?.({ kind: 'delta', delta: 'ok' });
      opts.onChunk?.({ kind: 'done' });
      return { text: 'ok', usage: null };
    };
    const engine = new AgentEngine({ modelRouter: { chat }, toolRegistry: reg, maxSteps: 2 });
    await engine.run({
      agent,
      messages: [{ role: 'user', content: 'go' }],
      cwd: '/',
      env: {},
      apiKey: 'sk',
      provider: { type: 'openai-compatible', baseUrl: 'https://x.com' },
      modelId: 'm1',
      modelCapabilities: { supportsTools: false, supportsImages: false, maxOutputTokens: 2048 },
      onNotice: (code) => { notices.push(code); },
    });
    expect(seen[0]?.tools).toBeUndefined();
    expect(seen[0]?.maxTokens).toBe(2048);
    expect(notices).toEqual(['MODEL_TOOLS_UNSUPPORTED']);
  });

  it('prefers engine cfg.maxTokens over model maxOutputTokens', async () => {
    const reg = new ToolRegistry();
    let maxTokens: number | undefined;
    const chat = async (req: { maxTokens?: number }, opts: { onChunk?: (c: ChatChunk) => void }) => {
      maxTokens = req.maxTokens;
      opts.onChunk?.({ kind: 'delta', delta: 'ok' });
      opts.onChunk?.({ kind: 'done' });
      return { text: 'ok', usage: null };
    };
    const engine = new AgentEngine({ modelRouter: { chat }, toolRegistry: reg, maxSteps: 1, maxTokens: 1 });
    await engine.run({
      agent,
      messages: [{ role: 'user', content: 'go' }],
      cwd: '/',
      env: {},
      apiKey: 'sk',
      provider: { type: 'openai-compatible', baseUrl: 'https://x.com' },
      modelId: 'm1',
      modelCapabilities: { maxOutputTokens: 4096, supportsTools: true, supportsImages: false },
    });
    expect(maxTokens).toBe(1);
  });

  it('throws MODEL_IMAGES_UNSUPPORTED when images are present and unsupported', async () => {
    const reg = new ToolRegistry();
    const engine = new AgentEngine({
      modelRouter: {
        chat: async () => {
          throw new Error('should not chat');
        },
      },
      toolRegistry: reg,
      maxSteps: 1,
    });
    await expect(engine.run({
      agent,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'see' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AA' } },
        ],
      }],
      cwd: '/',
      env: {},
      apiKey: 'sk',
      provider: { type: 'openai-compatible', baseUrl: 'https://x.com' },
      modelId: 'm1',
      modelCapabilities: { supportsTools: true, supportsImages: false },
    })).rejects.toThrow('MODEL_IMAGES_UNSUPPORTED');
  });
});
