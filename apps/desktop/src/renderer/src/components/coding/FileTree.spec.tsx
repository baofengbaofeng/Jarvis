import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { FileTree } from './FileTree';
import type { TreeNode } from '@jarvis/core/renderer';

const NODES: TreeNode[] = [
  { name: 'src', path: 'src', type: 'dir', children: [{ name: 'a.ts', path: 'src/a.ts', type: 'file', children: [] }] },
  { name: 'README.md', path: 'README.md', type: 'file', children: [] }
];

afterEach(() => { cleanup(); });

describe('FileTree', () => {
  it('renders directories as spans and files as buttons', () => {
    render(<FileTree nodes={NODES} onSelect={() => {}} />);
    expect(screen.getByTestId('tree-dir').textContent).toBe('src/');
    const files = screen.getAllByTestId('tree-file').map(n => n.textContent);
    expect(files).toContain('a.ts');
    expect(files).toContain('README.md');
  });

  it('calls onSelect with the file path on click', () => {
    const onSelect = vi.fn();
    render(<FileTree nodes={NODES} onSelect={onSelect} />);
    fireEvent.click(screen.getAllByTestId('tree-file')[0]);
    expect(onSelect).toHaveBeenCalledWith('src/a.ts');
  });
});
