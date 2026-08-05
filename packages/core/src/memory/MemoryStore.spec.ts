import { describe, it, expect } from 'vitest';
import { MemoryStore, buildMemoryInjection, type MemoryAdapter, type MemoryEntry } from './MemoryStore';
import { registerMemoryTools } from './MemoryStore';
import { ToolRegistry } from '../agent/ToolRegistry';
import type { AgentConfig } from '@jarvis/protocol';

// Minimal AgentConfig shape for the ctx.agent threading test (protocol's type
// is structural, so the extra fields are satisfied by the cast).
const mkAgent = (id: string): AgentConfig => ({ id, name: id, slug: id, description: '', systemPrompt: '', modelId: null, workspaceId: null, contextBudgetTokens: 0, planOnly: false, createdAt: '', updatedAt: '' });

const mkAdapter = (): MemoryAdapter => {
  const rows = new Map<string, MemoryEntry>();
  return {
    upsert(agentId, key, value) { const id = `${agentId}:${key}`; rows.set(id, { id, agentId, key, value, updatedAt: new Date().toISOString() }); },
    get(agentId, key) { return rows.get(`${agentId}:${key}`) ?? null; },
    list(agentId) { return [...rows.values()].filter(r => r.agentId === agentId); },
    remove(agentId, key) { rows.delete(`${agentId}:${key}`); }
  };
};

describe('memory store', () => {
  it('memorizes, recalls and forgets', () => {
    const store = new MemoryStore(mkAdapter());
    store.memorize('a', 'style', 'concise');
    expect(store.recall('a', 'style')[0].value).toBe('concise');
    expect(store.recall('a').length).toBe(1);
    store.forget('a', 'style');
    expect(store.recall('a').length).toBe(0);
  });

  it('builds an injection block', () => {
    const store = new MemoryStore(mkAdapter());
    store.memorize('a', 'lang', 'zh');
    const block = buildMemoryInjection(store.recall('a'));
    expect(block).toContain('<memory>');
    expect(block).toContain('lang: zh');
    expect(buildMemoryInjection([])).toBe('');
  });

  it('exposes memorize/recall tools', async () => {
    const reg = new ToolRegistry();
    const store = new MemoryStore(mkAdapter());
    registerMemoryTools(reg, store, 'a');
    await reg.execute({ id: '1', name: 'memorize', arguments: { key: 'pref', value: 'short answers' } }, { cwd: '/', env: {} });
    const r = await reg.execute({ id: '2', name: 'recall', arguments: {} }, { cwd: '/', env: {} });
    expect(r.output).toContain('pref: short answers');
  });

  // M6 final review (finding 3): a leader run then a member run on the SAME
  // registry must each memorize to their OWN memory. The baked agentId is a
  // fallback; ctx.agent (threaded through AgentEngine.run) wins when present.
  it('attributes memorize/recall to ctx.agent, not the baked registration agent', async () => {
    const reg = new ToolRegistry();
    const store = new MemoryStore(mkAdapter());
    registerMemoryTools(reg, store, 'baked');
    // Leader run issues a memorize with ctx.agent = leader.
    await reg.execute({ id: '1', name: 'memorize', arguments: { key: 'leaderKey', value: 'leaderVal' } }, { cwd: '/', env: {}, agent: mkAgent('leader') });
    // Member run issues a memorize with ctx.agent = member.
    await reg.execute({ id: '2', name: 'memorize', arguments: { key: 'memberKey', value: 'memberVal' } }, { cwd: '/', env: {}, agent: mkAgent('member') });
    expect(store.recall('leader', 'leaderKey')[0].value).toBe('leaderVal');
    expect(store.recall('member', 'memberKey')[0].value).toBe('memberVal');
    // The leader's write must NOT land on the baked/member memory.
    expect(store.recall('baked', 'leaderKey')).toHaveLength(0);
    expect(store.recall('member', 'leaderKey')).toHaveLength(0);
    // Without ctx.agent the baked id is the fallback (back-compat).
    await reg.execute({ id: '3', name: 'memorize', arguments: { key: 'k', value: 'v' } }, { cwd: '/', env: {} });
    expect(store.recall('baked', 'k')[0].value).toBe('v');
  });
});
