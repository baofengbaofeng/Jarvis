// L21 全局搜索: FTS5 结果的行结构与排序/转义纯函数。逻辑保持纯(不触 DB),
// main 进程负责把 SQLite FTS MATCH 行映射成 FtsRow 后再交给 rankFts 排序。

export interface FtsRow { table: string; id: string; title: string; snippet: string }

// FTS5 短语查询用双引号包裹;查询内的引号须按 FTS5 规则翻倍转义,否则 MATCH
// 语法会提前截断(未闭合引号报 syntax error)。
export function ftsEscape(query: string): string {
  return query.replace(/"/g, '""');
}

// 标题命中优先于仅正文命中(标题 +10, 正文 +5),稳定排序保持 SQL 返回顺序。
export function rankFts(results: FtsRow[], query: string): FtsRow[] {
  const q = query.toLowerCase();
  return results.map(r => ({
    r,
    score: (r.title.toLowerCase().includes(q) ? 10 : 0) + (r.snippet.toLowerCase().includes(q) ? 5 : 0)
  })).sort((a, b) => b.score - a.score).map(x => x.r);
}
