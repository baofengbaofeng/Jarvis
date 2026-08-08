import { BrowserWindow, app, screen, shell } from 'electron';
import { join } from 'node:path';
import { APP_DISPLAY_NAME, IpcEvent } from '@jarvis/protocol';
import { appResourcePath } from '../assets/appIconPath';
import { TrustedRendererPolicy, installNavigationGuards } from '../security/TrustedRendererPolicy';
import {
  MAC_TRAFFIC_LIGHT_POSITION,
  trafficLightPositionFor,
  windowChromePayload,
  type WindowChromePayload,
} from './macTitlebar';

export interface DisplayBounds { x: number; y: number; width: number; height: number; }

export function computeSnapBounds(display: DisplayBounds, side: 'left' | 'right', snapWidth: number): DisplayBounds {
  return side === 'right'
    ? { x: display.x + display.width - snapWidth, y: display.y, width: snapWidth, height: display.height }
    : { x: display.x, y: display.y, width: snapWidth, height: display.height };
}

const SNAP_WIDTH = 400;

export class WindowManager {
  private main: BrowserWindow | null = null;
  private snapSide: 'left' | 'right' = 'right';
  private chromeSyncTimer: ReturnType<typeof setTimeout> | null = null;

  createMainWindow(): BrowserWindow {
    if (this.main && !this.main.isDestroyed()) return this.main;
    const rendererRoot = join(import.meta.dirname, '../renderer');
    const policy = new TrustedRendererPolicy({
      rendererRoot,
      devOrigin: process.env['ELECTRON_RENDERER_URL'],
    });
    this.main = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      title: APP_DISPLAY_NAME,
      icon: appResourcePath('icon.png', import.meta.dirname, app.isPackaged, process.resourcesPath),
      // Overlay traffic lights so sidebar chrome can sit immediately to their right.
      ...(process.platform === 'darwin'
        ? {
            titleBarStyle: 'hidden' as const,
            trafficLightPosition: { ...MAC_TRAFFIC_LIGHT_POSITION },
          }
        : {}),
      webPreferences: {
        preload: this.preloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      }
    });
    this.main.setMenuBarVisibility(false);
    this.bindMacTitlebarChrome(this.main);

    const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
    if (rendererUrl) {
      void this.main.loadURL(rendererUrl);
    } else {
      const rendererIndex = join(rendererRoot, 'index.html');
      void this.main.loadFile(rendererIndex);
    }

    installNavigationGuards(this.main, policy, shell.openExternal);
    return this.main;
  }

  getMainWindow(): BrowserWindow | null {
    return this.main && !this.main.isDestroyed() ? this.main : null;
  }

  /** Snapshot used by window.getChrome invoke (avoids missed push-on-load races). */
  getWindowChrome(): WindowChromePayload {
    const win = this.getMainWindow();
    const fullscreen = win?.isFullScreen() === true;
    return windowChromePayload(fullscreen);
  }

  setSnapMode(on: boolean): void {
    if (!this.main || this.main.isDestroyed()) return;
    const display = screen.getDisplayMatching(this.main.getBounds());
    const bounds = computeSnapBounds(display.bounds, this.snapSide, SNAP_WIDTH);
    this.main.setBounds(on ? bounds : { x: display.bounds.x + 100, y: display.bounds.y + 80, width: 1200, height: 800 }, true);
  }

  toggleSnap(): void {
    this.snapSide = this.snapSide === 'right' ? 'left' : 'right';
    this.setSnapMode(true);
  }

  private bindMacTitlebarChrome(win: BrowserWindow): void {
    if (process.platform !== 'darwin') return;

    const sync = (fullscreen: boolean) => {
      if (win.isDestroyed()) return;
      const pos = trafficLightPositionFor(fullscreen);
      win.setWindowButtonPosition(pos);
      win.webContents.send(IpcEvent.windowChrome, windowChromePayload(fullscreen));
    };

    // macOS often re-layouts traffic lights after the transition animation.
    const syncSoon = (fullscreen: boolean) => {
      sync(fullscreen);
      if (this.chromeSyncTimer) clearTimeout(this.chromeSyncTimer);
      this.chromeSyncTimer = setTimeout(() => sync(fullscreen), 120);
    };

    win.on('enter-full-screen', () => syncSoon(true));
    win.on('leave-full-screen', () => syncSoon(false));
    win.on('maximize', () => sync(win.isFullScreen()));
    win.on('unmaximize', () => sync(win.isFullScreen()));
    win.webContents.on('did-finish-load', () => sync(win.isFullScreen()));
  }

  private preloadPath(): string {
    return join(import.meta.dirname, '../preload/index.cjs');
  }
}
