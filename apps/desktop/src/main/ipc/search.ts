import type Database from 'better-sqlite3';
// searchProvider/rankFts are pure office modules; searchWeb is the M1 legacy
// web_search implementation (packages/core/src/chat/search.ts) kept as the
// fallback when no L25 search_providers config is present.
import { ftsEscape, rankFts, buildSearchRequest, parseSearchResults, searchWeb, type FtsRow, type SearchProviderConfig, type SearchResultItem, type SearchConfig, type SafeHttpClient, type SafeFetchLimits } from '@jarvis/core';
import type { SettingsStore } from './settings';

// L21: global FTS5 search across chat_messages/agents/tasks (migration v3).
// Each table maps into a unified FtsRow so rankFts can boost title hits over
// snippet-only ones. FTS5 MATCH throws on an empty string, so guard it up
// front and return [] (no crash for a cleared search box). The query is
// wrapped as an FTS5 phrase with ftsEscape doubling embedded quotes.
export function globalSearch(db: Database.Database, query: string): FtsRow[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const q = `"${ftsEscape(trimmed)}"`;
  // tasks_fts indexes payload+result (the real tasks table has no
  // title/description); result_json is nullable, so coalesce to '' before
  // rankFts (which calls toLowerCase on both title and snippet).
  // `table` is a SQLite reserved word, so the alias is double-quoted.
  const msgs = (db.prepare(`SELECT 'message' AS "table", rowid AS id, '' AS title, content AS snippet FROM chat_messages_fts WHERE chat_messages_fts MATCH ? LIMIT 20`).all(q) as Array<Record<string, unknown>>).map(r => ({ table: r.table as string, id: String(r.id), title: String(r.title ?? ''), snippet: String(r.snippet ?? '') }));
  const agents = (db.prepare(`SELECT 'agent' AS "table", rowid AS id, name AS title, description AS snippet FROM agents_fts WHERE agents_fts MATCH ? LIMIT 20`).all(q) as Array<Record<string, unknown>>).map(r => ({ table: r.table as string, id: String(r.id), title: String(r.title ?? ''), snippet: String(r.snippet ?? '') }));
  const tasks = (db.prepare(`SELECT 'task' AS "table", rowid AS id, payload AS title, result AS snippet FROM tasks_fts WHERE tasks_fts MATCH ? LIMIT 20`).all(q) as Array<Record<string, unknown>>).map(r => ({ table: r.table as string, id: String(r.id), title: String(r.title ?? ''), snippet: String(r.snippet ?? '') }));
  return rankFts([...msgs, ...agents, ...tasks], trimmed);
}

export const DEFAULT_WEB_SEARCH_LIMITS: SafeFetchLimits = {
  timeoutMs: 15_000,
  maxRedirects: 3,
  maxResponseBytes: 5 * 1024 * 1024,
};

let defaultHttp: SafeHttpClient | null = null;

export function setDefaultWebSearchHttp(http: SafeHttpClient): void {
  defaultHttp = http;
}

export interface WebSearchDeps {
  http?: SafeHttpClient;
  /** @deprecated use `http` — kept for unit tests that mock fetch-shaped responses */
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  limits?: SafeFetchLimits;
}

function resolveHttp(deps: WebSearchDeps): SafeHttpClient {
  if (deps.http) return deps.http;
  if (deps.fetchImpl) {
    return {
      request: (url, init) => deps.fetchImpl!(url, init),
    };
  }
  if (defaultHttp) return defaultHttp;
  throw new Error('SEARCH_HTTP_CLIENT_MISSING');
}

// L25: web_search routing. Reads settings.search_providers — the NEW format is
// an array of SearchProviderConfig (the SearchProvidersPage form). When an
// enabled config exists, build + fire the provider request and parse the
// response. When none is configured, fall back to the M1 legacy implementation
// (searchWeb against the legacy object-form config under the same key). If
// neither exists, throw a clear error so the tool/IPC can surface it instead of
// an unhandled rejection. SafeHttpClient is injected for policy-enforced fetch.
export async function webSearch(settingsStore: SettingsStore, query: string, deps: WebSearchDeps = {}): Promise<SearchResultItem[]> {
  const http = resolveHttp(deps);
  const limits = deps.limits ?? DEFAULT_WEB_SEARCH_LIMITS;
  const raw = settingsStore.get('search_providers');
  if (Array.isArray(raw)) {
    const active = (raw as SearchProviderConfig[]).find(c => c.enabled);
    if (active) {
      const req = buildSearchRequest(active, query);
      let res: Response;
      try {
        res = await http.request(req.url, { method: req.body ? 'POST' : 'GET', headers: req.headers, body: req.body }, limits);
      } catch (e) {
        throw new Error(`search network error: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!res.ok) throw new Error(`search http ${res.status}`);
      return parseSearchResults(active.type, await res.json());
    }
    // Array present but nothing enabled → the legacy object form was
    // overwritten, so fall through to the no-config error below.
  }
  const legacy = (Array.isArray(raw) ? undefined : raw) as SearchConfig | undefined;
  if (legacy && legacy.endpoint && legacy.apiKey) {
    return searchWeb(query, legacy, {
      fetchImpl: async (url, init) => http.request(String(url), init, limits),
    });
  }
  throw new Error('未配置联网搜索源(设置→办公→搜索源)');
}
