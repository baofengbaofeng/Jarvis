import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../db/migrations';
import { createAgentStore } from './agents';

describe('agent store', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  it('creates and lists agent with slug', async () => {
    const store = createAgentStore(db);
    const a = store.create({ name: 'Coding Agent', systemPrompt: 'You write code', modelId: null, workspaceId: null });
    expect(a.slug).toBe('coding-agent');
    expect(store.list().length).toBe(1);
  });

  it('updates agent fields', async () => {
    const store = createAgentStore(db);
    const a = store.create({ name: 'A', systemPrompt: '', modelId: null, workspaceId: null });
    const updated = store.update(a.id, { systemPrompt: 'new prompt' });
    expect(updated.systemPrompt).toBe('new prompt');
  });
});
