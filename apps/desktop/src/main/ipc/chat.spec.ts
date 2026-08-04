import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { applyMigrations } from '../db/migrations';
import { registerChatHandlers } from './chat';
import type { SecureStorage } from '../secrets/SecureStorage';

const fakeEvent = {} as Electron.IpcMainInvokeEvent;

describe('chat handlers', () => {
  let db: Database.Database;
  // getWindow returns null so webContents.send is optional-chained to a no-op.
  const getWindow = () => null;
  // secrets.get is only reached inside the streaming success path, which these
  // deterministic error-path tests never hit.
  const secrets = { set: async () => {}, get: async () => null, delete: async () => {} } as unknown as SecureStorage;

  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  it('creates a session, lists it, and loads an empty message set', async () => {
    const chat = registerChatHandlers(db, secrets, getWindow);
    const s = await chat.createSession('Test chat');
    expect(s.title).toBe('Test chat');
    expect(s.id).toBeTruthy();

    const list = await chat.listSessions();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(s.id);
    expect(list[0].title).toBe('Test chat');

    expect(await chat.loadMessages(s.id)).toEqual([]);
  });

  it('creates a session without a title using the default', async () => {
    const chat = registerChatHandlers(db, secrets, getWindow);
    const s = await chat.createSession();
    expect(s.title).toBe('新对话');
  });

  it('send persists the user message before failing on a missing agent', async () => {
    const chat = registerChatHandlers(db, secrets, getWindow);
    const s = await chat.createSession('Test');

    await expect(chat.send(fakeEvent, { sessionId: s.id, text: 'hello', agentId: 'nope' }))
      .rejects.toThrow('agent not found: nope');

    // The user turn is appended before the agent lookup throws.
    expect(await chat.loadMessages(s.id)).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('send fails deterministically when the agent has no model/provider binding', async () => {
    const chat = registerChatHandlers(db, secrets, getWindow);
    const s = await chat.createSession('Test');
    const agentId = randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO agents (id, name, slug, description, system_prompt, model_id, workspace_id, context_budget_tokens, plan_only, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(agentId, 'No Model Agent', 'no-model', '', 'sys prompt', null, null, 128000, 0, now, now);

    await expect(chat.send(fakeEvent, { sessionId: s.id, text: 'hi', agentId }))
      .rejects.toThrow('agent has no valid model/provider binding');
  });
});
