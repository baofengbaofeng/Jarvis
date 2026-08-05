import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WipeService } from './WipeService';
import { DEFAULT_WIPE_TABLES } from '@jarvis/core';

// Every DEFAULT_WIPE_TABLES table must exist in the in-memory db, because
// WipeService DELETEs each allowlisted table verbatim (the allowlist guard
// filters table NAMES, not table existence).
function createSchema(db: Database.Database): void {
  db.exec(`CREATE TABLE chat_sessions (id TEXT PRIMARY KEY);
    CREATE TABLE chat_messages (id TEXT PRIMARY KEY, body TEXT);
    CREATE TABLE audit_logs (id TEXT PRIMARY KEY);
    CREATE TABLE token_usage (id INTEGER PRIMARY KEY);
    CREATE TABLE tasks (id TEXT PRIMARY KEY);
    CREATE TABLE agent_messages (id TEXT PRIMARY KEY);
    CREATE TABLE agent_call_edges (id TEXT PRIMARY KEY)`);
}

describe('WipeService', () => {
  it('deletes rows and keychain entries after matching phrase', async () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.exec("INSERT INTO chat_messages (id, body) VALUES ('a', 'x'), ('b', 'y')");
    let keys = 3;
    const svc = new WipeService(db, { deleteAllApiKeys: async () => { const n = keys; keys = 0; return n; } });
    const r = await svc.wipe({ tables: DEFAULT_WIPE_TABLES, keychain: true, workspace: false }, 'DELETE ALL');
    expect(r.deleted.chat_messages).toBe(2);
    expect(r.keychainDeleted).toBe(3);
    expect(r.vacuumed).toBe(true);
    expect((db.prepare('SELECT COUNT(*) c FROM chat_messages').get() as { c: number }).c).toBe(0);
  });

  it('rejects wrong phrase before touching anything', async () => {
    const db = new Database(':memory:');
    createSchema(db);
    const svc = new WipeService(db, { deleteAllApiKeys: async () => 0 });
    await expect(svc.wipe({ tables: DEFAULT_WIPE_TABLES, keychain: true, workspace: false }, 'nope')).rejects.toThrow('confirmation');
    expect((db.prepare('SELECT COUNT(*) c FROM chat_messages').get() as { c: number }).c).toBe(0);
  });

  it('skips tables outside the L20 allowlist and removes the workspace when requested', async () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.exec('CREATE TABLE providers (id TEXT PRIMARY KEY)');
    db.exec("INSERT INTO chat_messages (id, body) VALUES ('a', 'x')");
    db.exec("INSERT INTO providers (id) VALUES ('p1')");
    const ws = mkdtempSync(join(tmpdir(), 'jarvis-wipe-'));
    writeFileSync(join(ws, 'note.txt'), 'x');
    const svc = new WipeService(db, { deleteAllApiKeys: async () => 0 }, ws);
    const r = await svc.wipe({ tables: ['chat_messages', 'providers'], keychain: false, workspace: true }, 'DELETE');
    expect(r.deleted.chat_messages).toBe(1);
    // `providers` is NOT in DEFAULT_WIPE_TABLES, so it is guarded and left intact.
    expect(r.deleted.providers).toBeUndefined();
    expect((db.prepare('SELECT COUNT(*) c FROM providers').get() as { c: number }).c).toBe(1);
    expect(r.keychainDeleted).toBe(0);
    expect(r.workspaceRemoved).toBe(true);
    expect(existsSync(ws)).toBe(false);
  });
});
