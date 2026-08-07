import type { CSSProperties } from 'react';
import type { TreeNode } from '@jarvis/core/renderer';

export function FileTree({ nodes, onSelect, depth = 0 }: { nodes: TreeNode[]; onSelect: (path: string) => void; depth?: number }) {
  return (
    <ul className="file-tree" data-testid="file-tree">
      {nodes.map(n => (
        <li key={n.path} className="file-tree__item" style={{ '--tree-depth': depth } as CSSProperties}>
          {n.type === 'dir'
            ? <span data-testid="tree-dir">{n.name}/</span>
            : <button data-testid="tree-file" onClick={() => onSelect(n.path)}>{n.name}</button>}
          {n.children.length > 0 && <FileTree nodes={n.children} onSelect={onSelect} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}
