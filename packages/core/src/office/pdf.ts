export interface PdfMeta { pages: number; title?: string }

export function chunkPages(pageTexts: string[], maxChars = 4000): Array<{ from: number; to: number; texts: string[] }> {
  const out: Array<{ from: number; to: number; texts: string[] }> = [];
  let cur: { from: number; to: number; texts: string[] } | null = null;
  let acc = 0;
  pageTexts.forEach((t, i) => {
    if (!cur) cur = { from: i + 1, to: i + 1, texts: [] };
    if (acc + t.length > maxChars && cur.texts.length) {
      out.push(cur);
      cur = { from: i + 1, to: i + 1, texts: [] };
      acc = 0;
    }
    acc += t.length;
    cur.to = i + 1;
    cur.texts.push(t);
  });
  if (cur) out.push(cur);
  return out;
}

export function buildPdfSummaryPrompt(title: string | undefined, pageRange: { from: number; to: number }, pageTexts: string[]): string {
  const body = pageTexts.map((t, i) => `【第 ${pageRange.from + i} 页】\n${t}`).join('\n');
  return `请总结以下 PDF${title ? `《${title}》` : ''}第 ${pageRange.from}-${pageRange.to} 页的内容,输出结构化的中英对照要点:\n\n${body}`;
}
