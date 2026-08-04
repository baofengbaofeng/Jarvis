export interface SearchConfig { engine: 'tavily' | 'custom'; endpoint: string; apiKey: string }

export interface SearchResult { title: string; url: string; snippet: string }

export async function searchWeb(query: string, cfg: SearchConfig, deps: { fetchImpl?: typeof fetch } = {}): Promise<SearchResult[]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const res = await fetchImpl(cfg.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ query, max_results: 5 })
  });
  if (!res.ok) throw new Error(`search http ${res.status}`);
  const data = (await res.json()) as { results?: Array<{ title: string; url: string; snippet: string }> };
  return (data.results ?? []).map(r => ({ title: r.title, url: r.url, snippet: r.snippet }));
}
