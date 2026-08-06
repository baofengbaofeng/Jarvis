import { describe, it, expect, vi } from 'vitest';

const listeners: Record<string, Array<(event: { preventDefault: () => void }, url: string) => void>> = {};
let windowOpenHandler: ((details: { url: string }) => { action: string }) | null = null;
let lastWebPreferences: Record<string, unknown> | null = null;

vi.mock('electron', () => ({
  BrowserWindow: class {
    webContents = {
      on: (event: string, cb: (event: { preventDefault: () => void }, url: string) => void) => {
        (listeners[event] ??= []).push(cb);
      },
      setWindowOpenHandler: (handler: (details: { url: string }) => { action: string }) => {
        windowOpenHandler = handler;
      },
      loadURL: vi.fn(),
      loadFile: vi.fn(),
    };
    setMenuBarVisibility = vi.fn();
    loadURL = vi.fn();
    loadFile = vi.fn();
    constructor(_opts: { webPreferences?: Record<string, unknown> }) {
      lastWebPreferences = _opts.webPreferences ?? null;
    }
  },
  screen: { getDisplayMatching: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }) },
  shell: { openExternal: vi.fn() },
}));

import { shell } from 'electron';
import { computeSnapBounds, WindowManager } from './WindowManager';

describe('computeSnapBounds', () => {
  const display = { x: 0, y: 0, width: 1920, height: 1080 };
  it('snaps to right edge with 400px width', () => {
    const b = computeSnapBounds(display, 'right', 400);
    expect(b).toEqual({ x: 1520, y: 0, width: 400, height: 1080 });
  });
  it('snaps to left edge', () => {
    const b = computeSnapBounds(display, 'left', 400);
    expect(b.x).toBe(0);
    expect(b.width).toBe(400);
  });
});

describe('WindowManager navigation guards', () => {
  it('enables sandbox and blocks untrusted navigation', () => {
    const wm = new WindowManager();
    wm.createMainWindow();
    expect(lastWebPreferences?.sandbox).toBe(true);

    const willNavigate = listeners['will-navigate']![0];
    const evt = { preventDefault: vi.fn() };
    willNavigate(evt, 'https://example.com');
    expect(evt.preventDefault).toHaveBeenCalled();
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/');

    const fileEvt = { preventDefault: vi.fn() };
    willNavigate(fileEvt, 'file:///etc/passwd');
    expect(fileEvt.preventDefault).toHaveBeenCalled();
    expect(shell.openExternal).not.toHaveBeenCalledWith('file:///etc/passwd');
  });

  it('denies window.open and opens https externally', () => {
    const wm = new WindowManager();
    wm.createMainWindow();
    expect(windowOpenHandler).toBeTruthy();
    const result = windowOpenHandler!({ url: 'https://example.com/page' });
    expect(result).toEqual({ action: 'deny' });
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/page');
  });
});
