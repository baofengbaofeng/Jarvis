import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DropZone } from './DropZone';

afterEach(cleanup);

describe('DropZone', () => {
  it('attaches image files and copies others to workspace via capabilities', async () => {
    const invoke = vi.fn(async (m: string, args?: unknown) => {
      if (m === 'dialog.pickPath') {
        const req = args as { purpose: string };
        if (req.purpose === 'office-file') {
          return [{ token: 'cap-img', name: 'a.png', kind: 'file', sizeBytes: 1, expiresAt: 1 }];
        }
        return [{ token: 'cap-copy', name: 'notes.txt', kind: 'file', sizeBytes: 1, expiresAt: 1 }];
      }
      return { ok: true };
    });
    (window as unknown as { jarvis: unknown }).jarvis = { invoke, onDidReceive: () => () => {} };
    const onAttach = vi.fn();
    const onCopied = vi.fn();
    render(<DropZone onAttach={onAttach} onCopied={onCopied}><div>composer</div></DropZone>);
    const zone = screen.getByTestId('drop-zone');
    fireEvent.drop(zone, { dataTransfer: { files: [{ name: 'a.png' }, { name: 'notes.txt' }] } });
    await vi.waitFor(() => expect(onAttach).toHaveBeenCalledWith([expect.objectContaining({ token: 'cap-img', name: 'a.png' })]));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('workspace.copyFiles', { capabilities: ['cap-copy'] }));
    expect(onCopied).toHaveBeenCalledWith(['notes.txt']);
  });
});
