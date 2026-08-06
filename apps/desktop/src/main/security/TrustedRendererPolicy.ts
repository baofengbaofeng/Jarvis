import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface TrustedRendererPolicyOptions {
  rendererRoot: string;
  devOrigin?: string;
}

export class TrustedRendererPolicy {
  private readonly root: string;
  private readonly devOrigin?: string;
  constructor(opts: TrustedRendererPolicyOptions) {
    this.root = resolve(opts.rendererRoot);
    this.devOrigin = opts.devOrigin ? new URL(opts.devOrigin).origin : undefined;
  }
  isTrustedUrl(raw: string): boolean {
    try {
      const url = new URL(raw);
      if (url.protocol === 'file:') {
        const rel = relative(this.root, resolve(fileURLToPath(url)));
        return rel === 'index.html' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.includes(sep));
      }
      return Boolean(this.devOrigin && url.origin === this.devOrigin && ['127.0.0.1', '[::1]'].includes(url.hostname));
    } catch {
      return false;
    }
  }
}

export function assertTrustedIpcEvent(
  event: IpcMainInvokeEvent,
  mainWindow: BrowserWindow | null,
  policy: TrustedRendererPolicy,
): void {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('IPC_UNTRUSTED_WINDOW');
  if (event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('IPC_UNTRUSTED_FRAME');
  if (!policy.isTrustedUrl(event.senderFrame.url)) throw new Error('IPC_UNTRUSTED_ORIGIN');
}

export function installNavigationGuards(
  window: BrowserWindow,
  policy: TrustedRendererPolicy,
  openExternal: (url: string) => void | Promise<void>,
): void {
  const deny = (event: Electron.Event, url: string) => {
    if (policy.isTrustedUrl(url)) return;
    event.preventDefault();
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') void openExternal(parsed.toString());
  };
  window.webContents.on('will-navigate', deny);
  (window.webContents as { on: (event: string, listener: typeof deny) => void }).on('will-frame-navigate', deny);
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:') void openExternal(parsed.toString());
    } catch {
      // Malformed targets are denied without escaping the navigation guard.
    }
    return { action: 'deny' };
  });
}
