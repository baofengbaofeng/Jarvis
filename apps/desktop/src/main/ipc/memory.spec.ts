import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../db/migrations';
import { createMemoryAdapter } from './memory';
import { MemoryStore, buildMemoryInjection } from '@jarvis/core';

describe('memory adapter (F11)', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  it('upserts, gets, lists and removes agent memory', () => {
    const m = createMemoryAdapter(db);
    m.upsert('a1', 'style', 'concise');
    m.upsert('a1', 'lang', 'zh');
    m.upsert('a2', 'style', 'verbose');

    // get returns the exact value written for that (agent, key).
    expect(m.get('a1', 'style')).toMatchObject({ agentId: 'a1', key: 'style', value: 'concise' });

    // list is scoped to ONE agent (no cross-agent bleed).
    const a1 = m.list('a1');
    expect(a1.map(e => e.key).sort()).toEqual(['lang', 'style']);
    expect(m.list('a2').map(e => e.key)).toEqual(['style']);

    m.remove('a1', 'style');
    expect(m.get('a1', 'style')).toBeNull();
    expect(m.list('a1').map(e => e.key)).toEqual(['lang']);
    // Removing one agent's key leaves the other agent's same-key row intact.
    expect(m.get('a2', 'style')).not.toBeNull();
  });

  it('upsert overwrites in place (UNIQUE(agent_id, key)) and refreshes updated_at', () => {
    const m = createMemoryAdapter(db);
    m.upsert('a1', 'pref', 'first');
    const before = m.get('a1', 'pref')!;
    m.upsert('a1', 'pref', 'second');
    const after = m.get('a1', 'pref')!;
    expect(after.value).toBe('second');
    // Single row survives the conflict (no duplicate (agent_id, key)).
    const count = db.prepare('SELECT COUNT(*) AS n FROM agent_memory WHERE agent_id = ? AND key = ?').get('a1', 'pref') as { n: number };
    expect(count.n).toBe(1);
    expect(after.updatedAt >= before.updatedAt).toBe(true);
  });

  it('serves the core MemoryStore memorize/recall/forget + injection (per-agent scoped)', () => {
    const store = new MemoryStore(createMemoryAdapter(db));
    store.memorize('a1', 'lang', 'zh');
    store.memorize('a2', 'lang', 'en');
    expect(buildMemoryInjection(store.recall('a1'))).toContain('lang: zh');
    expect(buildMemoryInjection(store.recall('a1'))).not.toContain('lang: en');
    store.forget('a1', 'lang');
    expect(buildMemoryInjection(store.recall('a1'))).toBe('');
  });
});
