import { describe, it, expect, vi } from 'vitest';

const listeners: Record<string, Array<(event: { preventDefault: () => void }, url: string) => void>> = {};
const windowListeners: Record<string, Array<() => void>> = {};
let windowOpenHandler: ((details: { url: string }) => { action: string }) | null = null;
let lastWebPreferences: Record<string, unknown> | null = null;
let lastWindowOpts: Record<string, unknown> | null = null;
const setWindowButtonPosition = vi.fn();
const send = vi.fn();

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: class {
    webContents = {
      on: (event: string, cb: (...args: unknown[]) => void) => {
        (listeners[event] ??= []).push(cb as (event: { preventDefault: () => void }, url: string) => void);
      },
      setWindowOpenHandler: (handler: (details: { url: string }) => { action: string }) => {
        windowOpenHandler = handler;
      },
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      send,
    };
    setMenuBarVisibility = vi.fn();
    setWindowButtonPosition = setWindowButtonPosition;
    isDestroyed = () => false;
    isFullScreen = () => false;
    loadURL = vi.fn();
    loadFile = vi.fn();
    on = (event: string, cb: () => void) => {
      (windowListeners[event] ??= []).push(cb);
    };
    constructor(opts: { webPreferences?: Record<string, unknown> }) {
      lastWindowOpts = opts as Record<string, unknown>;
      lastWebPreferences = opts.webPreferences ?? null;
    }
  },
  screen: { getDisplayMatching: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }) },
  shell: { openExternal: vi.fn() },
}));

import { shell } from 'electron';
import { IpcEvent } from '@jarvis/protocol';
import { computeSnapBounds, WindowManager } from './WindowManager';
import { MAC_TRAFFIC_LIGHT_POSITION, MAC_TRAFFIC_LIGHT_POSITION_FULLSCREEN } from './macTitlebar';

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
    if (process.platform === 'darwin') {
      expect(lastWindowOpts?.titleBarStyle).toBe('hidden');
      expect(lastWindowOpts?.trafficLightPosition).toEqual({ ...MAC_TRAFFIC_LIGHT_POSITION });
    }

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

  it('moves traffic lights and collapse inset left on fullscreen', () => {
    if (process.platform !== 'darwin') return;
    setWindowButtonPosition.mockClear();
    send.mockClear();
    const wm = new WindowManager();
    wm.createMainWindow();
    expect(windowListeners['enter-full-screen']?.length).toBeGreaterThan(0);
    windowListeners['enter-full-screen']![0]!();
    expect(setWindowButtonPosition).toHaveBeenCalledWith({ ...MAC_TRAFFIC_LIGHT_POSITION_FULLSCREEN });
    expect(send).toHaveBeenCalledWith(
      IpcEvent.windowChrome,
      expect.objectContaining({ fullscreen: true, titleInset: 16 }),
    );
  });
});
