import { app, BrowserWindow } from 'electron';
import { openDatabase } from './db/connection';
import { runMigrations } from './db/migrations';
import { IpcRouter } from './ipc/IpcRouter';
import { TrayManager } from './tray/TrayManager';
import { WindowManager } from './window/WindowManager';

// Cold-start bootstrap for M0. db (Task 5), ipc (Task 6), windows (Task 10) and
// tray (Task 11) are wired here. Task 12 wires DaemonSupervisor.
export async function bootstrap(): Promise<void> {
  const db = openDatabase();
  runMigrations(db);
  const ipc = new IpcRouter(db);
  ipc.registerAll();
  ipc.listen();

  const windows = new WindowManager();
  const tray = new TrayManager({
    onQuit: () => app.quit(),
    onOpen: () => windows.createMainWindow(),
    onRestartDaemon: () => { /* Task 12 wires daemon.restart() */ }
  });

  tray.create();
  windows.createMainWindow();
}

app.whenReady().then(() => {
  void bootstrap();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      new WindowManager().createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
