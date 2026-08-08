import { Tray, Menu, app, nativeImage } from 'electron';
import { appResourcePath } from '../assets/appIconPath';

export interface TrayCallbacks {
  onOpen: () => void;
  onQuit: () => void;
  onRestartDaemon: () => void;
}

const TRAY_LABELS: Record<string, Record<string, string>> = {
  'zh-CN': { open: '打开 J.A.R.V.I.S', daemon: 'Daemon 状态', restart: '重启 Daemon', quit: '退出' },
  en: { open: 'Open J.A.R.V.I.S', daemon: 'Daemon Status', restart: 'Restart Daemon', quit: 'Quit' }
};

export class TrayManager {
  private tray: Tray | null = null;
  private daemonOk = false;
  private lang = 'zh-CN';

  constructor(private callbacks: TrayCallbacks) {}

  setLanguage(lang: string): void { this.lang = lang; }

  create(): Tray {
    const iconPath = appResourcePath('tray-icon.png', import.meta.dirname, app.isPackaged, process.resourcesPath);
    const icon = nativeImage.createFromPath(iconPath);
    this.tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    this.rebuildMenu();
    this.tray.on('click', () => this.callbacks.onOpen());
    return this.tray;
  }

  updateDaemonStatus(ok: boolean): void {
    this.daemonOk = ok;
    this.rebuildMenu();
  }

  private labels(): Record<string, string> { return TRAY_LABELS[this.lang] ?? TRAY_LABELS.en; }

  private rebuildMenu(): void {
    if (!this.tray) return;
    const L = this.labels();
    const status = this.daemonOk ? '●' : '○';
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: L.open, click: () => this.callbacks.onOpen() },
      { label: `${status} ${L.daemon}`, enabled: false },
      { type: 'separator' },
      { label: L.restart, click: () => this.callbacks.onRestartDaemon() },
      { type: 'separator' },
      { label: L.quit, click: () => this.callbacks.onQuit() }
    ]));
  }
}
