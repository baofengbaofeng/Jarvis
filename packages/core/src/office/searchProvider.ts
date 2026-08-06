// L25 联网搜索源配置: 把「一个 SearchProviderConfig」转成具体的 HTTP 请求
// (buildSearchRequest) 并把响应体解析成统一 SearchResultItem 行。纯函数、
// 无 fetch 副作用,main 进程负责实际请求(webSearch helper 注入 fetch 以便测试)。

export type SearchProviderType = 'bing' | 'brave' | 'tavily' | 'serper';
export interface SearchProviderConfig { type: SearchProviderType; apiKey: string; enabled: boolean }
export interface SearchResultItem { title: string; url: string; snippet: string }
export interface SearchRequest { url: string; headers: Record<string, string>; body?: string }

export function buildSearchRequest(provider: SearchProviderConfig, query: string, opts: { limit?: number } = {}): SearchRequest {
  const limit = opts.limit ?? 5;
  switch (provider.type) {
    case 'tavily':
      return { url: 'https://api.tavily.com/search', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ api_key: provider.apiKey, query, max_results: limit }) };
    case 'serper':
      return { url: 'https://google.serper.dev/search', headers: { 'content-type': 'application/json', 'X-API-KEY': provider.apiKey }, body: JSON.stringify({ q: query, num: limit }) };
    case 'bing':
      return { url: `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${limit}`, headers: { 'Ocp-Apim-Subscription-Key': provider.apiKey } };
    case 'brave':
      return { url: `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`, headers: { 'X-Subscription-Token': provider.apiKey } };
  }
}

export function parseSearchResults(provider: SearchProviderType, body: unknown): SearchResultItem[] {
  const b = body as Record<string, unknown>;
  if (provider === 'serper') {
    return ((b.organic as Array<{ title?: string; link?: string; snippet?: string }>) ?? []).map(r => ({ title: r.title ?? '', url: r.link ?? '', snippet: r.snippet ?? '' }));
  }
  if (provider === 'tavily') {
    return ((b.results as Array<{ title?: string; url?: string; content?: string }>) ?? []).map(r => ({ title: r.title ?? '', url: r.url ?? '', snippet: r.content ?? '' }));
  }
  if (provider === 'bing') {
    return (((b.webPages as { value?: Array<{ name?: string; url?: string; snippet?: string }> } | undefined)?.value) ?? []).map(r => ({ title: r.name ?? '', url: r.url ?? '', snippet: r.snippet ?? '' }));
  }
  if (provider === 'brave') {
    return (((b.web as { results?: Array<{ title?: string; url?: string; description?: string }> } | undefined)?.results) ?? []).map(r => ({ title: r.title ?? '', url: r.url ?? '', snippet: r.description ?? '' }));
  }
  return [];
}
