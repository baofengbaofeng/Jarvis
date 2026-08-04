import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../db/migrations';
import { createMcpStore } from './mcp';

describe('mcp store', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  it('creates stdio server', () => {
    const store = createMcpStore(db);
    const s = store.create({ name: 'fs', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] });
    expect(s.transport).toBe('stdio');
    expect(store.list().length).toBe(1);
  });
});
