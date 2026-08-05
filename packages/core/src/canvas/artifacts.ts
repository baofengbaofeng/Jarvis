export type ArtifactKind = 'table' | 'chart' | 'mermaid' | 'markdown';
export interface Artifact { id: string; taskId: string; kind: ArtifactKind; title?: string; content: string }
export interface TableData { headers: string[]; rows: string[][] }
export interface DataPoint { label: string; value: number }

export function parseTable(markdown: string): TableData {
  const lines = markdown.trim().split('\n').filter(l => l.trim().startsWith('|'));
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = cells(lines[0]);
  const rows = lines.slice(2).map(cells); // 跳过分隔行
  return { headers, rows };
}
export function extractMermaid(text: string): string | null {
  const m = text.match(/```mermaid\s*\n([\s\S]*?)```/);
  return m ? m[1].trim() : null;
}
export function captureArtifacts(taskId: string, resultText: string): Artifact[] {
  const out: Artifact[] = [];
  // A markdown table is a run of 3+ consecutive lines each starting with '|'
  // (header, separator, >=1 data row). The run stops at the first non-'|' line,
  // so a following ```mermaid block is never swallowed into the table content.
  // NOTE: the plan's /^\|[\s\S]*?\n\|[\s\S]*?(?=\n\n|$)/m regex is buggy under
  // the /m flag — `$` matches at every LINE end, so the lazy body stops right
  // after the separator line (2 lines) and never captures a real table. This
  // line-run form matches the plan's stated intent (a table with >=3 lines)
  // without that flag interaction.
  const tableBlock = resultText.match(/(?:^|\n)((?:\|[^\n]*\n?){3,})/);
  if (tableBlock) out.push({ id: `${taskId}-t1`, taskId, kind: 'table', content: tableBlock[1].trim() });
  const md = extractMermaid(resultText);
  if (md) out.push({ id: `${taskId}-m1`, taskId, kind: 'mermaid', content: md });
  if (out.length === 0 && resultText.trim()) out.push({ id: `${taskId}-md1`, taskId, kind: 'markdown', content: resultText.trim() });
  return out;
}
export function dataPointSeries(records: Array<{ label: string; value: number }>): DataPoint[] { return records; }
