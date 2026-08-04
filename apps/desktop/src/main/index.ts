import { app, BrowserWindow } from 'electron';
import { openDatabase } from './db/connection';
import { runMigrations } from './db/migrations';
import { IpcRouter } from './ipc/IpcRouter';
import { TrayManager } from './tray/TrayManager';
import { WindowManager } from './window/WindowManager';
import { DaemonSupervisor } from './daemon/DaemonSupervisor';

// Cold-start bootstrap for M0. db (Task 5), ipc (Task 6), windows (Task 10),
// tray (Task 11) and daemon (Task 12) are wired here.
const daemon = new DaemonSupervisor();

export async function bootstrap(): Promise<void> {
  const db = openDatabase();
  runMigrations(db);
  const ipc = new IpcRouter(db);
  ipc.registerAll(daemon);
  ipc.listen();

  const windows = new WindowManager();
  const tray = new TrayManager({
    onQuit: () => app.quit(),
    onOpen: () => windows.createMainWindow(),
    onRestartDaemon: () => daemon.restart()
  });

  tray.create();
  daemon.start(() => tray.updateDaemonStatus(true), () => tray.updateDaemonStatus(false));
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

app.on('will-quit', () => daemon.stop());
