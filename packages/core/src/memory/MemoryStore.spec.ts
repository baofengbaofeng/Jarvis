import { describe, it, expect } from 'vitest';
import { MemoryStore, buildMemoryInjection, type MemoryAdapter, type MemoryEntry } from './MemoryStore';
import { registerMemoryTools } from './MemoryStore';
import { ToolRegistry } from '../agent/ToolRegistry';

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
});
