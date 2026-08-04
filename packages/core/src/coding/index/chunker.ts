export interface Chunk { id: string; path: string; startLine: number; endLine: number; text: string }

export function chunkFile(path: string, text: string, maxLines = 120): Chunk[] {
  const lines = text.split('\n');
  const out: Chunk[] = [];
  let start = 0;
  const sigRe = /^(export\s+)?(default\s+)?(async\s+)?(function|class|interface|type|const\s+\w+\s*=)\b/;
  for (let i = 0; i <= lines.length; i++) {
    const atEnd = i === lines.length;
    const tooLong = i - start >= maxLines;
    const blankBoundary = !atEnd && /^\s*$/.test(lines[i]) && i - start >= 4;
    const sigBoundary = !atEnd && sigRe.test(lines[i]) && i - start >= 4;
    if (i > start && (atEnd || tooLong || blankBoundary || sigBoundary)) {
      out.push({ id: `${path}:${start + 1}-${i}`, path, startLine: start + 1, endLine: i, text: lines.slice(start, i).join('\n') });
      start = i;
    }
  }
  return out;
}
