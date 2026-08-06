import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: class {},
  screen: { getDisplayMatching: () => ({ x: 0, y: 0, width: 1920, height: 1080 }) },
  shell: { openExternal: async () => {} }
}));

import { computeSnapBounds } from './WindowManager';

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
