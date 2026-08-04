import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

// Reduced cold-start bootstrap for M0. Later tasks wire their pieces in here:
// Task 5 (db/migrations), Task 6 (IpcRouter), Task 10 (WindowManager),
// Task 11 (DaemonSupervisor), Task 12 (TrayManager).
export function createMainWindow(): BrowserWindow {
  // electron-vite emits the preload as ESM (.mjs) because package.json is
  // "type": "module"; ESM preloads require sandbox disabled.
  const preload = join(import.meta.dirname, '../preload/index.mjs');
  const rendererIndex = join(import.meta.dirname, '../renderer/index.html');

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'JARVIS',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.setMenuBarVisibility(false);

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl) {
    void win.loadURL(rendererUrl);
  } else {
    // loadFile handles the file URL (including the Windows drive-letter form),
    // avoiding the invalid `file://C:\...` that string concatenation would produce.
    void win.loadFile(rendererIndex);
  }

  return win;
}

export async function bootstrap(): Promise<void> {
  createMainWindow();
}

app.whenReady().then(() => {
  void bootstrap();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
