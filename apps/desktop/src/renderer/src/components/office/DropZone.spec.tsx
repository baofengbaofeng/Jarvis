import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DropZone } from './DropZone';

// No i18n init needed — DropZone renders no strings (wraps children). vitest
// globals are off, so @testing-library/react does not auto-cleanup; unmount after
// every test like the sibling component specs.
afterEach(cleanup);

describe('DropZone', () => {
  it('attaches image files and copies others to workspace', async () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    const onAttach = vi.fn(); const onCopied = vi.fn();
    render(<DropZone onAttach={onAttach} onCopied={onCopied}><div>composer</div></DropZone>);
    const zone = screen.getByTestId('drop-zone');
    fireEvent.drop(zone, { dataTransfer: { files: [
      { name: 'a.png', path: '/tmp/a.png' },
      { name: 'notes.txt', path: '/tmp/notes.txt' }
    ] } });
    expect(onAttach).toHaveBeenCalledWith([expect.objectContaining({ name: 'a.png' })]);
    expect(invoke).toHaveBeenCalledWith('workspace.copyFiles', ['/tmp/notes.txt']);
  });
});
