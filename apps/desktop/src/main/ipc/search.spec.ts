import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../db/migrations';
import { globalSearch, webSearch, setDefaultWebSearchHttp } from './search';
import { SafeUrlPolicy } from '../security/SafeUrlPolicy';
import type { SettingsStore } from './settings';
import type { SearchProviderConfig } from '@jarvis/core';

function makeSettings(initial: Record<string, unknown> = {}): SettingsStore {
  const data = new Map(Object.entries(initial));
  return {
    get: (key, fallback) => (data.has(key) ? data.get(key) : fallback),
    set: (key, value) => { data.set(key, value); },
    getAll: () => Object.fromEntries(data)
  };
}

// Fake Response shape: only ok/status/json are consumed by webSearch.
function fakeRes(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe('globalSearch (L21)', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    applyMigrations(db);
    db.prepare("INSERT INTO chat_sessions (id, title, created_at, updated_at) VALUES ('s1', 't', '2026-01-01', '2026-01-01')").run();
    // Agents trigger populates agents_fts(name, description).
    db.prepare("INSERT INTO agents (id, name, slug, description, system_prompt, env_vars_json, cli_args_json, created_at, updated_at) VALUES ('a1', 'reviewer', 'reviewer', 'summarizes patches for jarvis search', 'sys', '{}', '[]', '2026-01-01', '2026-01-01')").run();
    // chat_messages trigger populates chat_messages_fts(content).
    db.prepare("INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES ('m1', 's1', 'user', 'jarvis setup guide', '2026-01-01')").run();
    db.prepare("INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES ('m2', 's1', 'user', 'plain message without keyword', '2026-01-01')").run();
    // tasks trigger populates tasks_fts(payload, result); result_json NULL →
    // snippet coalesced to '' by globalSearch.
    db.prepare("INSERT INTO tasks (id, agent_id, status, payload_json, result_json, created_at) VALUES ('t1', 'a1', 'completed', 'write jarvis docs', NULL, '2026-01-01')").run();
  });

  it('searches chat_messages, agents and tasks via their FTS tables', () => {
    const rows = globalSearch(db, 'jarvis');
    const tables = rows.map(r => r.table).sort();
    expect(tables).toEqual(['agent', 'message', 'task']);
    expect(rows.find(r => r.table === 'task')?.snippet).toBe('');
  });

  it('ranks title (payload/name) hits above snippet-only matches', () => {
    const rows = globalSearch(db, 'jarvis');
    // task payload 'write jarvis docs' is a title hit (+10); the agent
    // description and the message body only match in snippet (+5).
    expect(rows[0].table).toBe('task');
    expect(rows[0].id).toBe('1');
  });

  it('returns [] for an empty or whitespace query (FTS5 MATCH would throw)', () => {
    expect(globalSearch(db, '')).toEqual([]);
    expect(globalSearch(db, '   ')).toEqual([]);
  });

  // Regression guards for the AU (UPDATE) and AD (DELETE) FTS triggers — the
  // riskiest deviations from the brief (DELETE-instead-of-the-'delete'-command
  // and the added UPDATE triggers). A future change back to the 'delete' command
  // or a broken AU trigger must fail these, not just pass the INSERT tests.
  it('AU trigger: updating a source row replaces the indexed text', () => {
    db.prepare("UPDATE chat_messages SET content = 'gibberish value' WHERE id = 'm1'").run();
    // The old content no longer matches this message (other rows still match).
    const afterUpdate = globalSearch(db, 'jarvis');
    expect(afterUpdate.find(r => r.table === 'message' && r.id === '1')).toBeUndefined();
    // The new content matches the same row.
    const newText = globalSearch(db, 'gibberish');
    expect(newText.find(r => r.table === 'message' && r.id === '1')?.snippet).toBe('gibberish value');
  });

  it('AU trigger: the multi-column agents trigger follows a description edit', () => {
    db.prepare("UPDATE agents SET description = 'plain description' WHERE id = 'a1'").run();
    const rows = globalSearch(db, 'jarvis');
    expect(rows.find(r => r.table === 'agent')).toBeUndefined();
  });

  it('AD trigger: deleting a source row removes it from the index', () => {
    db.prepare("DELETE FROM chat_messages WHERE id = 'm1'").run();
    const rows = globalSearch(db, 'jarvis');
    // 'jarvis' still matches the agent description + task payload, but not the
    // deleted message (rowid 1) — proving the DELETE-rowid trigger fired.
    expect(rows.some(r => r.table === 'message')).toBe(false);
  });
});

describe('webSearch (L25)', () => {
  it('routes through an enabled L25 config using buildSearchRequest + parse', async () => {
    const settings = makeSettings({
      search_providers: [
        { type: 'serper', apiKey: 'k', enabled: true },
        { type: 'brave', apiKey: 'k2', enabled: false }
      ] as SearchProviderConfig[]
    });
    const fetchImpl = vi.fn(async () => fakeRes({ organic: [{ title: 'T', link: 'https://x', snippet: 'S' }] }));
    const out = await webSearch(settings, 'jarvis', { fetchImpl });
    expect(out[0]).toEqual({ title: 'T', url: 'https://x', snippet: 'S' });
    // The request used the first ENABLED config (serper), not brave.
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body?: string }];
    expect(url).toContain('serper');
    expect(init.headers['X-API-KEY']).toBe('k');
  });

  it('throws a clear error on a non-ok provider response', async () => {
    const settings = makeSettings({ search_providers: [{ type: 'tavily', apiKey: 'k', enabled: true }] });
    await expect(webSearch(settings, 'q', { fetchImpl: async () => fakeRes({}, false, 500) }))
      .rejects.toThrow('search http 500');
  });

  it('throws a clear error when the network fetch fails', async () => {
    const settings = makeSettings({ search_providers: [{ type: 'brave', apiKey: 'k', enabled: true }] });
    await expect(webSearch(settings, 'q', { fetchImpl: async () => { throw new Error('boom'); } }))
      .rejects.toThrow('search network error: boom');
  });

  it('falls back to the M1 legacy searchWeb when no L25 config is enabled', async () => {
    const settings = makeSettings({
      search_providers: { engine: 'custom', endpoint: 'https://search.example.com', apiKey: 'sk-x' }
    });
    const fetchImpl = vi.fn(async () => fakeRes({ results: [{ title: 'T', url: 'https://x', snippet: 'S' }] }));
    const out = await webSearch(settings, 'jarvis', { fetchImpl });
    expect(out[0]).toEqual({ title: 'T', url: 'https://x', snippet: 'S' });
    // M1 searchWeb POSTs to the legacy endpoint with a Bearer token.
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://search.example.com');
    expect(init.headers.Authorization).toBe('Bearer sk-x');
  });

  it('throws a clear error when nothing is configured', async () => {
    await expect(webSearch(makeSettings(), 'q', { fetchImpl: async () => fakeRes({}) }))
      .rejects.toThrow('未配置联网搜索源');
  });

  it('routes production webSearch through setDefaultWebSearchHttp policy client', async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
    const fetchImpl = vi.fn().mockResolvedValue(fakeRes({ organic: [{ title: 'T', link: 'https://x', snippet: 'S' }] }));
    setDefaultWebSearchHttp(new SafeUrlPolicy({ lookup, fetchImpl }));

    const settings = makeSettings({
      search_providers: [{ type: 'serper', apiKey: 'k', enabled: true }] as SearchProviderConfig[],
    });
    const out = await webSearch(settings, 'jarvis');

    expect(out[0]).toEqual({ title: 'T', url: 'https://x', snippet: 'S' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toContain('serper');
    expect(init.headers['X-API-KEY']).toBe('k');
    expect(lookup).toHaveBeenCalledWith('google.serper.dev');
  });
});
