import { BrowserWindow, screen, shell } from 'electron';
import { join } from 'node:path';
import { TrustedRendererPolicy, installNavigationGuards } from '../security/TrustedRendererPolicy';

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
      title: 'JARVIS',
      webPreferences: {
        preload: this.preloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      }
    });
    this.main.setMenuBarVisibility(false);

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

  private preloadPath(): string {
    return join(import.meta.dirname, '../preload/index.cjs');
  }
}
