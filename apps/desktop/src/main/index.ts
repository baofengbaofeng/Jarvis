import { app, BrowserWindow } from 'electron';
import { openDatabase } from './db/connection';
import { runMigrations } from './db/migrations';
import { IpcRouter } from './ipc/IpcRouter';
import { createSettingsStore } from './ipc/settings';
import { closeAllMcpClients } from './ipc/mcp';
import { TrayManager } from './tray/TrayManager';
import { WindowManager } from './window/WindowManager';
import { DaemonSupervisor } from './daemon/DaemonSupervisor';

// Cold-start bootstrap for M0. db (Task 5), ipc (Task 6), windows (Task 10),
// tray (Task 11) and daemon (Task 12) are wired here.
const daemon = new DaemonSupervisor();

export async function bootstrap(): Promise<void> {
  const db = openDatabase();
  runMigrations(db);
  const settings = createSettingsStore(db);
  // C10: the daemon is sized from the saved settings.concurrency value on every
  // (re)start; the provider reads live so a save + daemon.restart picks it up.
  daemon.setConcurrencyProvider(() => (settings.get('concurrency') ?? {}) as { perAgent?: number; machine?: number });
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

app.on('will-quit', () => {
  daemon.stop();
  closeAllMcpClients();
});
