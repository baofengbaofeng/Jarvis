import { useState, type DragEvent, type ReactNode } from 'react';
// decideDrop is a pure office module, so import it from the renderer-safe entry
// (@jarvis/core/renderer) rather than the full barrel, which pulls Node deps.
// This is a RUNTIME import (not type-only) — the component calls decideDrop.
import { decideDrop } from '@jarvis/core/renderer';

// Drag-drop wrapper for the chat composer (L22). Images/docs stay in the
// composer (attach); every other file is copied into the bound workspace via the
// main-side workspace.copyFiles channel. No user-facing strings, so no i18n keys
// are needed — it wraps children and never renders text itself.
export function DropZone({ children, onAttach, onCopied }: {
  children: ReactNode;
  onAttach: (files: Array<{ name: string; path: string }>) => void;
  onCopied: (names: string[]) => void;
}) {
  const [over, setOver] = useState(false);
  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    // Electron's File has a non-standard `path` property carrying the OS path;
    // fall back to the name when the runtime does not expose it (headless test).
    const files = [...e.dataTransfer.files].map(f => ({ name: f.name, path: (f as File & { path?: string }).path ?? f.name }));
    const { attach, copyToWorkspace } = decideDrop(files);
    // Deliver attachments FIRST (synchronously) so the composer renders them
    // immediately; the copy-to-workspace round-trip below is async and must not
    // delay that. This also keeps the drop handler's sync test meaningful.
    if (attach.length) onAttach(attach);
    if (copyToWorkspace.length) {
      try {
        // A copy failure (no bound workspace, missing source) either resolves
        // with { ok:false } or rejects — both must not throw unhandled out of
        // the drop handler (Task 1 constraint). onCopied only fires on success.
        const r = (await window.jarvis.invoke('workspace.copyFiles', copyToWorkspace.map(f => f.path))) as { ok: boolean };
        if (r.ok) onCopied(copyToWorkspace.map(f => f.name));
      } catch {
        /* fire-and-forget: the composer UI stays usable on a failed copy */
      }
    }
  };
  return (
    <div data-testid="drop-zone" className={over ? 'drop-zone drop-zone--over' : 'drop-zone'}
      onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={e => void onDrop(e)}>
      {children}
    </div>
  );
}
