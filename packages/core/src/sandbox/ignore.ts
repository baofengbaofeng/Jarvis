export function parseIgnorePatterns(patterns: string[]): RegExp[] {
  const out: RegExp[] = [];
  for (const raw of patterns) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('!')) continue; // 否定暂不完整支持
    let p = line;
    if (p.endsWith('/')) p = p.slice(0, -1) + '(?:/.*)?$';
    else if (!p.includes('/')) p = `(?:^|/)${p.replace(/\./g, '\\.').replace(/\*/g, '[^/]*')}$`;
    else p = p.replace(/\./g, '\\.').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\/$/, '(?:/.*)?$');
    try { out.push(new RegExp(p)); } catch { /* skip bad pattern */ }
  }
  return out;
}

export function isIgnored(absPath: string, patterns: RegExp[]): boolean {
  return patterns.some(rx => rx.test(absPath));
}
