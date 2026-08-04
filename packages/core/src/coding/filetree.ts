export interface TreeNode { name: string; path: string; type: 'file' | 'dir'; children: TreeNode[] }
export interface TreeEntry { name: string; isDir: boolean }
export interface TreeFs { listDir(p: string): TreeEntry[] }

export function buildTree(root: string, fs: TreeFs, isIgnored: (rel: string) => boolean, maxDepth = 12): TreeNode[] {
  const walk = (dir: string, relPrefix: string, depth: number): TreeNode[] => {
    if (depth > maxDepth) return [];
    const out: TreeNode[] = [];
    for (const e of fs.listDir(dir)) {
      if (e.name === '.jarvis') continue;
      if (e.name.startsWith('.') && e.name !== '.git') continue;
      const rel = relPrefix ? `${relPrefix}/${e.name}` : e.name;
      if (isIgnored(rel)) continue;
      out.push(e.isDir
        ? { name: e.name, path: rel, type: 'dir', children: walk(`${dir}/${e.name}`, rel, depth + 1) }
        : { name: e.name, path: rel, type: 'file', children: [] });
    }
    out.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1);
    return out;
  };
  return walk(root, '', 0);
}
