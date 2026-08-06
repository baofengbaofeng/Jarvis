import { describe, it, expect, vi } from 'vitest';
import { openMainWindow } from './mainWindowLifecycle';

describe('openMainWindow', () => {
  it('reuses the same WindowManager and attaches capability revoke on each recreate', () => {
    const win = { id: 'main' };
    const windows = { createMainWindow: vi.fn(() => win) };
    const ipc = { attachMainWindowRevoke: vi.fn() };

    expect(openMainWindow(windows as never, ipc as never)).toBe(win);
    expect(windows.createMainWindow).toHaveBeenCalledOnce();
    expect(ipc.attachMainWindowRevoke).toHaveBeenCalledWith(win);

    openMainWindow(windows as never, ipc as never);
    expect(windows.createMainWindow).toHaveBeenCalledTimes(2);
    expect(ipc.attachMainWindowRevoke).toHaveBeenCalledTimes(2);
  });
});
