import { app, BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import { openDatabase } from './db/connection';
import { runMigrations } from './db/migrations';
import { IpcRouter } from './ipc/IpcRouter';
import { createSettingsStore } from './ipc/settings';
import { closeAllMcpClients } from './ipc/mcp';
import { createSnapshotStore, loadTaskDiff } from './ipc/coding';
import { createAgentStore } from './ipc/agents';
import { IdeBridge, parseFileArg, openInExternalIde, resolveFileInWorkspace } from './external/IdeBridge';
import { TrayManager } from './tray/TrayManager';
import { WindowManager } from './window/WindowManager';
import { DaemonSupervisor } from './daemon/DaemonSupervisor';

// Cold-start bootstrap for M0. db (Task 5), ipc (Task 6), windows (Task 10),
// tray (Task 11) and daemon (Task 12) are wired here.
const daemon = new DaemonSupervisor();

// M4 Task 9 (E12): the localhost IDE bridge. Started at app ready and closed on
// will-quit. It binds 127.0.0.1 with no auth — acceptable for a local tool that
// only serves paths inside the user's own workspace (resolveFile is contained by
// resolveFileInWorkspace below), but it is NOT a remote-safe endpoint.
let ideBridge: IdeBridge | null = null;

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

  // M4 Task 9 (E12): start the external-IDE bridge. resolveFile is CONTAINED to
  // the single-active workspace (same getWorkspace assumption as workspace.tree):
  // a relative path that escapes the workspace root (e.g. ../../etc/passwd) is
  // rejected before any read, so the HTTP endpoint cannot be abused to read
  // arbitrary files. resolveTaskDiff reuses the task snapshot/git base contract
  // from diff.applyAll via loadTaskDiff.
  const agents = createAgentStore(db);
  const getWorkspace = (): string | null => agents.list().find(a => a.workspaceId)?.workspaceId ?? null;
  const snapshotStore = createSnapshotStore(db);
  ideBridge = new IdeBridge({
    resolveFile: (rel) => {
      const ws = getWorkspace();
      return ws ? resolveFileInWorkspace(rel, ws) : null;
    },
    resolveTaskDiff: (taskId) => loadTaskDiff(getWorkspace(), taskId, snapshotStore)
  });
  void ideBridge.start();

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

// `jarvis open --file <path[:line]>` opens the file in the external IDE: `code
// -g file:line` first, falling back to the system opener (`open` on macOS,
// xdg-open on Linux, cmd start on Windows) when the VS Code CLI is not
// installed. The OS-open fallback only receives the bare path — `open`/xdg-open
// take a path, not a path:line spec.
function openFileInIde(file: string, line?: number): void {
  openInExternalIde((args) => {
    const child = spawn('code', args, { stdio: 'inherit' });
    child.on('error', () => {
      const spec = file;
      if (process.platform === 'darwin') spawn('open', [spec], { stdio: 'inherit' });
      else if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', spec.replace(/\//g, '\\')], { stdio: 'inherit' });
      else spawn('xdg-open', [spec], { stdio: 'inherit' });
    });
  }, file, line);
}

// Best-effort parse of the `open --file` argv form (works for both the initial
// launch argv and the second-instance argv of a single-instance lock): find the
// --file flag and treat the next token as the path[:line] spec. Returns true
// when the argv was handled.
function handleOpenArgv(argv: string[]): boolean {
  const i = argv.indexOf('--file');
  if (i < 0 || !argv[i + 1] || argv[i + 1].startsWith('-')) return false;
  const { file, line } = parseFileArg(argv[i + 1]);
  openFileInIde(file, line);
  return true;
}

// M4 Task 9 (E12) CLI wiring: a single app instance owns the IDE bridge, and
// every later `jarvis open --file` invocation is forwarded to the running
// instance via the second-instance argv (Electron delivers the full argv of the
// second launch).
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (handleOpenArgv(argv)) {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
    }
  });

  app.whenReady().then(() => {
    void bootstrap();
    // Handle the very first launch when it IS an `open --file` invocation.
    handleOpenArgv(process.argv);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        new WindowManager().createMainWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  daemon.stop();
  closeAllMcpClients();
  void ideBridge?.close();
});
