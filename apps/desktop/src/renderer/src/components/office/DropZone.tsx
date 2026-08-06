import { useState, type DragEvent, type ReactNode } from 'react';
import { decideDrop } from '@jarvis/core/renderer';

export interface PickedCapability {
  token: string;
  name: string;
  kind: 'file' | 'directory';
  sizeBytes: number;
  expiresAt: number;
}

// Drag-drop wrapper for the chat composer (L22). Images/docs are picked via
// dialog.pickPath (SEC-02); other files are copied into the bound workspace
// through capability tokens. No user-facing strings, so no i18n keys.
export function DropZone({ children, onAttach, onCopied }: {
  children: ReactNode;
  onAttach: (files: PickedCapability[]) => void;
  onCopied: (names: string[]) => void;
}) {
  const [over, setOver] = useState(false);

  const routeDroppedNames = async (names: string[]) => {
    const stubs = names.map(name => ({ name, path: name }));
    const { attach, copyToWorkspace } = decideDrop(stubs);
    if (attach.length) {
      const caps = (await window.jarvis.invoke('dialog.pickPath', {
        purpose: 'office-file',
        multiple: attach.length > 1,
      })) as PickedCapability[];
      if (caps.length) onAttach(caps);
    }
    if (copyToWorkspace.length) {
      try {
        const caps = (await window.jarvis.invoke('dialog.pickPath', {
          purpose: 'workspace-copy',
          multiple: copyToWorkspace.length > 1,
        })) as PickedCapability[];
        if (!caps.length) return;
        const r = (await window.jarvis.invoke('workspace.copyFiles', {
          capabilities: caps.map(c => c.token),
        })) as { ok: boolean };
        if (r.ok) onCopied(caps.map(c => c.name));
      } catch {
        /* fire-and-forget: the composer UI stays usable on a failed copy */
      }
    }
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    await routeDroppedNames([...e.dataTransfer.files].map(f => f.name));
  };

  return (
    <div data-testid="drop-zone" className={over ? 'drop-zone drop-zone--over' : 'drop-zone'}
      onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={e => void onDrop(e)}>
      {children}
    </div>
  );
}
