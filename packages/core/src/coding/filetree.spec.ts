import { describe, it, expect } from 'vitest';
import { buildTree, type TreeFs } from './filetree';

const fs: TreeFs = {
  listDir(p) {
    if (p === '/ws') return [{ name: 'src', isDir: true }, { name: 'README.md', isDir: false }, { name: 'node_modules', isDir: true }, { name: '.jarvis', isDir: true }];
    if (p === '/ws/src') return [{ name: 'a.ts', isDir: false }];
    return [];
  }
};

describe('buildTree', () => {
  it('builds nested tree, filters ignored and dot-jarvis, sorts dirs first', () => {
    const tree = buildTree('/ws', fs, (rel) => rel.startsWith('node_modules') || rel.includes('.jarvis'));
    expect(tree.map(n => n.name)).toEqual(['src', 'README.md']);
    expect(tree[0].children[0].name).toBe('a.ts');
    expect(tree.find(n => n.name === 'README.md')!.type).toBe('file');
  });
});
