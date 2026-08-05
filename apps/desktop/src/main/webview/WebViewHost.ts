import { BrowserWindow, session } from 'electron';

// Minimal window surface the host drives. Kept as a structural interface so the
// lifecycle (open → extract → close) can be unit-tested with a fake window; the
// real BrowserWindow conforms to it.
export interface WebViewWindow {
  webContents: { executeJavaScript(js: string): Promise<unknown> };
  loadURL(url: string): Promise<void>;
  close(): void;
  on(event: 'closed', cb: () => void): void;
}

export interface WebViewHostDeps {
  // Injected window factory so the host's lifecycle can be tested without a real
  // Electron main process. Defaults to a real BrowserWindow on a throwaway
  // in-memory partition.
  createWindow?: (partition: string) => WebViewWindow;
}

// I8 会话隔离: every open() uses a fresh in-memory partition
// (webview-<timestamp>), so cookies/localStorage never leak between pages or
// into the app's default session. The window is sandboxed — it is a read-only
// page viewer, not a place where node integration should ever be reachable.
// D8 一键总结: extract() returns the rendered page's innerText (trimmed to
// 20000 chars); main-side pure extraction (core extractMainText) is the fallback
// for raw HTML in office.summarize.
export class WebViewHost {
  private win: WebViewWindow | null = null;
  private readonly createWindow: (partition: string) => WebViewWindow;

  constructor(deps: WebViewHostDeps = {}) {
    this.createWindow = deps.createWindow ?? ((partition: string) => {
      // Creating the session first with cache disabled ensures the partition the
      // window is routed to (webPreferences.partition) is the no-cache session.
      session.fromPartition(partition, { cache: false });
      return new BrowserWindow({
        width: 900,
        height: 700,
        webPreferences: { partition, sandbox: true }
      });
    });
  }

  async open(url: string): Promise<void> {
    const partition = `webview-${Date.now()}`;
    this.win = this.createWindow(partition);
    this.win.on('closed', () => { this.win = null; });
    await this.win.loadURL(url);
  }

  async extract(): Promise<string> {
    if (!this.win) return '';
    const js = `(() => { const el = document.querySelector('article, main, [role=main]') || document.body; return el.innerText.slice(0, 20000); })()`;
    return (await this.win.webContents.executeJavaScript(js)) as string;
  }

  close(): void { this.win?.close(); this.win = null; }
  isOpen(): boolean { return this.win !== null; }
}
