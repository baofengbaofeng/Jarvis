import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { IpcEvent } from '@jarvis/protocol';
import { ModelRouter } from '@jarvis/core';
import { applyMigrations } from '../db/migrations';
import { registerChatHandlers } from './chat';
import type { SecureStorage } from '../secrets/SecureStorage';
import type { BrowserWindow } from 'electron';

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

  it('deletes a session and cascades its messages', async () => {
    const chat = registerChatHandlers(db, secrets, getWindow);
    const s = await chat.createSession('To delete');
    db.prepare("INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES ('m1', ?, 'user', 'hi', '2026-01-01')").run(s.id);
    await chat.deleteSession(s.id);
    expect(await chat.listSessions()).toEqual([]);
    expect((db.prepare('SELECT COUNT(*) AS c FROM chat_messages WHERE session_id = ?').get(s.id) as { c: number }).c).toBe(0);
  });

  it('renames a session title', async () => {
    const chat = registerChatHandlers(db, secrets, getWindow);
    const s = await chat.createSession('Old title');
    const renamed = await chat.renameSession(s.id, '  Renamed chat  ');
    expect(renamed.title).toBe('Renamed chat');
    expect(renamed.id).toBe(s.id);
    const list = await chat.listSessions();
    expect(list[0].title).toBe('Renamed chat');
  });

  it('send persists the user message before failing on a missing agent', async () => {
    const chat = registerChatHandlers(db, secrets, getWindow);
    const s = await chat.createSession('Test');

    await expect(chat.send(fakeEvent, { sessionId: s.id, text: 'hello', agentId: 'nope' }))
      .rejects.toThrow('agent not found: nope');

    // The user turn is appended before the agent lookup throws.
    const loaded = await chat.loadMessages(s.id);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBeTruthy();
    expect(loaded[0].sessionId).toBe(s.id);
    expect(loaded[0].role).toBe('user');
    expect(loaded[0].content).toBe('hello');
    expect(loaded[0].createdAt).toBeTruthy();
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

  it('streams a success path: user persisted first, assistant text accumulated, chatDelta/chatDone forwarded', async () => {
    const send = vi.fn();
    const getWindow = () => ({ webContents: { send } }) as unknown as BrowserWindow;
    const fakeRouter = {
      chat: async (_req: unknown, opts: { onChunk?: (c: { kind: string; delta?: string }) => void }) => {
        opts.onChunk?.({ kind: 'delta', delta: 'Hello' });
        opts.onChunk?.({ kind: 'delta', delta: ' world' });
        opts.onChunk?.({ kind: 'done' });
        return { text: 'Hello world', usage: null };
      }
    } as unknown as ModelRouter;

    const chat = registerChatHandlers(db, secrets, getWindow, { router: fakeRouter });
    const s = await chat.createSession('Test');

    const now = new Date().toISOString();
    const providerId = randomUUID();
    const modelId = randomUUID();
    const agentId = randomUUID();
    db.prepare('INSERT INTO providers (id, name, type, base_url, api_key_ref, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(providerId, 'P', 'openai-compatible', 'https://x.com', `provider:${providerId}:key`, now, now);
    db.prepare('INSERT INTO models (id, provider_id, model_id, name, created_at) VALUES (?,?,?,?,?)')
      .run(modelId, providerId, 'm-1', 'M1', now);
    db.prepare('INSERT INTO agents (id, name, slug, description, system_prompt, model_id, workspace_id, context_budget_tokens, plan_only, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(agentId, 'A', `a-${agentId}`, '', 'sys', modelId, null, 128000, 0, now, now);

    await chat.send(fakeEvent, { sessionId: s.id, text: 'hi', agentId });

    // User message persisted before streaming; assistant message (accumulated full text) after.
    const loaded = await chat.loadMessages(s.id);
    expect(loaded).toHaveLength(2);
    expect(loaded[0].role).toBe('user');
    expect(loaded[0].content).toBe('hi');
    expect(loaded[1].role).toBe('assistant');
    expect(loaded[1].content).toBe('Hello world');

    // chatDelta events forwarded for each delta chunk.
    const deltaChunks = send.mock.calls
      .filter(c => c[0] === IpcEvent.chatDelta && (c[1] as { chunk?: { kind?: string; delta?: string } }).chunk?.kind === 'delta')
      .map(c => (c[1] as { chunk: { delta: string } }).chunk.delta);
    expect(deltaChunks).toEqual(['Hello', ' world']);

    const doneCalls = send.mock.calls.filter(c => c[0] === IpcEvent.chatDone);
    expect(doneCalls).toHaveLength(1);
    expect(doneCalls[0][1]).toEqual({ sessionId: s.id });
  });
});
