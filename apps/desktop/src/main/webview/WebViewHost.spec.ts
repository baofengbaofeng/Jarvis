import { describe, it, expect, vi } from 'vitest';
// WebViewHost imports 'electron' at module scope; stub it so the host can be
// constructed under vitest without a real Electron main process. The tests below
// inject a fake window factory (the createWindow dep), so the BrowserWindow /
// session stubs are never actually exercised.
vi.mock('electron', () => ({
  BrowserWindow: class {},
  session: { fromPartition: vi.fn(() => ({})) }
}));

import { WebViewHost } from './WebViewHost';
import type { WebViewWindow } from './WebViewHost';

interface FakeWindow extends WebViewWindow {
  id: number;
  /** 'closed' callbacks registered via on('closed') (includes the host's guard). */
  closedCbs: Array<() => void>;
  /** True once close() has been called on this window (the real signal). */
  wasClosed: boolean;
}

// Builds a fake window factory that records each created window and, when a
// window's close() is called, flags it and fires its 'closed' callbacks
// (mirroring Electron's close → 'closed' lifecycle).
function fakeWindowFactory() {
  const windows: FakeWindow[] = [];
  let nextId = 0;
  return {
    windows,
    createWindow: (): WebViewWindow => {
      const id = ++nextId;
      const win: FakeWindow = {
        id,
        closedCbs: [],
        wasClosed: false,
        loadURL: async () => {},
        webContents: { executeJavaScript: async () => 'page text' },
        close: () => {
          win.wasClosed = true;
          for (const cb of win.closedCbs) cb();
        },
        on: (event: string, cb: () => void) => { if (event === 'closed') win.closedCbs.push(cb); }
      };
      windows.push(win);
      return win;
    }
  };
}

describe('WebViewHost', () => {
  it('closes the previous window before opening a new one', async () => {
    const { windows, createWindow } = fakeWindowFactory();
    const host = new WebViewHost({ createWindow });

    await host.open('https://a.example');
    await host.open('https://b.example');

    expect(windows).toHaveLength(2);
    expect(host.isOpen()).toBe(true);
    await expect(host.extract()).resolves.toBe('page text');
  });

  it('the first window is closed by the second open, not orphaned', async () => {
    const { windows, createWindow } = fakeWindowFactory();
    const host = new WebViewHost({ createWindow });

    await host.open('https://a.example');
    const first = windows[0];
    expect(first).toBeTruthy();

    await host.open('https://b.example');

    // this.close() at the top of the second open() closed the first window
    // rather than leaving it visible with no reference.
    expect(first.wasClosed).toBe(true);
    expect(windows[1].wasClosed).toBe(false);
    expect(host.isOpen()).toBe(true);
  });

  it('a stale window close event does not null the reference to the current window', async () => {
    const { windows, createWindow } = fakeWindowFactory();
    const host = new WebViewHost({ createWindow });

    await host.open('https://a.example');
    await host.open('https://b.example');
    const first = windows[0];
    const second = windows[1];

    // Simulate the user closing the (now orphaned) first window AFTER the second
    // is open. Without the `this.win === win` guard this would null the current
    // window and isOpen() would report a closed host.
    for (const cb of first.closedCbs) cb();

    expect(host.isOpen()).toBe(true);
    await expect(host.extract()).resolves.toBe('page text');
    expect(second.wasClosed).toBe(false); // second window untouched
  });

  it('waits for assertAllowedUrl before createWindow', async () => {
    const order: string[] = [];
    const { createWindow } = fakeWindowFactory();
    const host = new WebViewHost({
      createWindow: (_partition) => {
        order.push('createWindow');
        return createWindow();
      },
      assertAllowedUrl: async () => { order.push('assertAllowedUrl'); },
    });
    await host.open('https://example.com');
    expect(order).toEqual(['assertAllowedUrl', 'createWindow']);
  });

  it('does not create a BrowserWindow when assertAllowedUrl rejects', async () => {
    const { windows, createWindow } = fakeWindowFactory();
    const host = new WebViewHost({
      createWindow,
      assertAllowedUrl: async () => { throw new Error('URL_PRIVATE_ADDRESS'); },
    });
    await expect(host.open('https://internal.example')).rejects.toThrow('URL_PRIVATE_ADDRESS');
    expect(windows).toHaveLength(0);
    expect(host.isOpen()).toBe(false);
  });
});
