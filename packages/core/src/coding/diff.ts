export type DiffLineType = 'context' | 'add' | 'del';
export interface DiffLine { type: DiffLineType; text: string }
export interface Hunk { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: DiffLine[] }

export function diffLines(a: string[], b: string[]): DiffLine[] {
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: 'context', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: a[i] }); i++; }
    else { out.push({ type: 'add', text: b[j] }); j++; }
  }
  while (i < n) { out.push({ type: 'del', text: a[i] }); i++; }
  while (j < m) { out.push({ type: 'add', text: b[j] }); j++; }
  return out;
}

export function groupHunks(diff: DiffLine[], context = 3): Hunk[] {
  const hunks: Hunk[] = [];
  let oldPos = 1, newPos = 1;
  const n = diff.length;
  let i = 0;
  while (i < n) {
    if (diff[i].type === 'context') { oldPos++; newPos++; i++; continue; }
    let j = i;
    while (j < n && diff[j].type !== 'context') j++; // change run 结束(含上下文前的位置)
    let cb = 0;
    for (let k = i - 1; k >= 0 && diff[k].type === 'context' && cb < context; k--) cb++;
    const hunkStart = i - cb;
    let ca = 0;
    for (let l = j; l < n && diff[l].type === 'context' && ca < context; l++) ca++;
    const hunkEnd = j + ca;
    const lines = diff.slice(hunkStart, hunkEnd);
    const oldLines = lines.filter(x => x.type !== 'add').length;
    const newLines = lines.filter(x => x.type !== 'del').length;
    hunks.push({ oldStart: oldPos - cb, oldLines, newStart: newPos - cb, newLines, lines });
    for (let p = i; p < hunkEnd; p++) { if (diff[p].type !== 'add') oldPos++; if (diff[p].type !== 'del') newPos++; }
    i = hunkEnd;
  }
  return hunks;
}

export function toUnified(hunks: Hunk[]): string {
  const out: string[] = [];
  for (const h of hunks) {
    out.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
    for (const l of h.lines) out.push(`${l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}${l.text}`);
  }
  return out.join('\n');
}

export function parseUnified(text: string): Hunk[] {
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  for (const line of text.split('\n')) {
    const m = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/.exec(line);
    if (m) {
      if (cur) hunks.push(cur);
      cur = { oldStart: +m[1], oldLines: +m[2], newStart: +m[3], newLines: +m[4], lines: [] };
      continue;
    }
    if (!cur) continue;
    const type: DiffLineType = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'context';
    cur.lines.push({ type, text: line.slice(1) });
  }
  if (cur) hunks.push(cur);
  return hunks;
}

export function applyHunks(base: string[], hunks: Hunk[], accepts: boolean[]): string[] {
  let out = base;
  let offset = 0;
  for (let i = 0; i < hunks.length; i++) {
    const h = hunks[i];
    const start = h.oldStart - 1 + offset;
    // The new region (context + add) and the old region (context + del) both
    // carry the hunk's context lines, so neither accept nor reject loses them.
    const newRegion = h.lines.filter(l => l.type !== 'del').map(l => l.text);
    const oldRegion = h.lines.filter(l => l.type !== 'add').map(l => l.text);
    const replacement = accepts[i] ? newRegion : oldRegion;
    out = [...out.slice(0, start), ...replacement, ...out.slice(start + h.oldLines)];
    offset += replacement.length - h.oldLines;
  }
  return out;
}
