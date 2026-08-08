import { dialog } from 'electron';
import { APP_DISPLAY_NAME } from '@jarvis/protocol';

/** DESK-03: surface cold-start failures instead of an unhandled rejection. */
export function reportBootstrapFailure(
  err: unknown,
  showError: (title: string, content: string) => void = dialog.showErrorBox,
): void {
  const msg = err instanceof Error ? err.message : String(err);
  showError(`${APP_DISPLAY_NAME} failed to start`, msg);
}

export async function runBootstrapSafe(
  boot: () => Promise<void>,
  report: (err: unknown) => void = reportBootstrapFailure,
): Promise<boolean> {
  try {
    await boot();
    return true;
  } catch (err) {
    report(err);
    return false;
  }
}
