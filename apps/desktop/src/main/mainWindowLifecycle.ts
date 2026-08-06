import type { BrowserWindow } from 'electron';
import type { WindowManager } from './window/WindowManager';
import type { IpcRouter } from './ipc/IpcRouter';

/** Create or show the main window and attach SEC-02 capability revoke for this owner. */
export function openMainWindow(windows: WindowManager, ipc: IpcRouter): BrowserWindow {
  const win = windows.createMainWindow();
  ipc.attachMainWindowRevoke(win);
  return win;
}
