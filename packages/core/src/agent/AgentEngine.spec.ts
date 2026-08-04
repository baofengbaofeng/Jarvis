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
});
