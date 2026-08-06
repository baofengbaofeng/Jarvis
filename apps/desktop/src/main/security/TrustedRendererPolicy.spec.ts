import { describe, expect, it } from 'vitest';
import { TrustedRendererPolicy, assertTrustedIpcEvent } from './TrustedRendererPolicy';

describe('TrustedRendererPolicy', () => {
  const policy = new TrustedRendererPolicy({
    rendererRoot: '/app/out/renderer',
    devOrigin: 'http://127.0.0.1:5173',
  });

  it('allows packaged renderer files and the configured loopback dev origin only', () => {
    expect(policy.isTrustedUrl('file:///app/out/renderer/index.html')).toBe(true);
    expect(policy.isTrustedUrl('http://127.0.0.1:5173/settings')).toBe(true);
    expect(policy.isTrustedUrl('https://evil.example/')).toBe(false);
    expect(policy.isTrustedUrl('http://localhost:5173/')).toBe(false);
  });

  it('rejects a different window and a subframe', () => {
    const mainFrame = { url: 'file:///app/out/renderer/index.html' };
    const webContents = { id: 7, mainFrame };
    const mainWindow = { webContents };
    expect(() => assertTrustedIpcEvent(
      { sender: { id: 8 }, senderFrame: mainFrame } as never,
      mainWindow as never,
      policy,
    )).toThrow('IPC_UNTRUSTED_WINDOW');
    expect(() => assertTrustedIpcEvent(
      { sender: webContents, senderFrame: { url: mainFrame.url } } as never,
      mainWindow as never,
      policy,
    )).toThrow('IPC_UNTRUSTED_FRAME');
  });
});
