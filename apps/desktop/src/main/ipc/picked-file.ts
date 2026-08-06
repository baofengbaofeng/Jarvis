import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let lastPickedPath: string | null = null;

/** Record a path returned by dialog.openFile (file-picker mode). */
export function setLastPickedFile(path: string): void {
  lastPickedPath = resolve(path);
}

export function clearLastPickedFile(): void {
  lastPickedPath = null;
}

/** Read text only from the most recently dialog-picked file path. */
export function readLastPickedFile(requestedPath: string): string | { ok: false; error: string } {
  if (!lastPickedPath) {
    return { ok: false, error: 'no file picked' };
  }
  const resolved = resolve(requestedPath);
  if (resolved !== lastPickedPath) {
    return { ok: false, error: 'path not from file picker' };
  }
  try {
    return readFileSync(resolved, 'utf8');
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
