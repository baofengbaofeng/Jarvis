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
  assertAllowedUrl?: (url: string) => Promise<void>;
}

// I8 会话隔离: every open() uses a fresh in-memory partition
// (webview-<timestamp>), so cookies/localStorage never leak between pages or
// into the app's default session. The window is sandboxed — it is a read-only
// page viewer, not a place where node integration should ever be reachable.
// D8 一键总结: extract() returns the rendered page's innerText (trimmed to
// 20000 chars); main-side pure extraction (core extractMainText) is the fallback
// for raw HTML in office.summarize.
export class WebViewHost {
  // Monotonic counter for partition names: Date.now() alone would collide when
  // two opens land in the same millisecond. Note the throwaway in-memory
  // partitions/sessions accumulate for the app lifetime — an accepted trade-off
  // of per-open isolation (I8).
  private static seq = 0;
  private win: WebViewWindow | null = null;
  private readonly createWindow: (partition: string) => WebViewWindow;
  private readonly assertAllowedUrl?: (url: string) => Promise<void>;

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
    this.assertAllowedUrl = deps.assertAllowedUrl;
  }

  async open(url: string): Promise<void> {
    if (this.assertAllowedUrl) await this.assertAllowedUrl(url);
    // Close any window already up (office.webview.open leaves one open) so a
    // second open can't orphan it. The 'closed' handler is guarded so a stale
    // window's close event (fired later) can't null the reference to the CURRENT
    // window.
    this.close();
    const partition = `webview-${++WebViewHost.seq}`;
    const win = this.createWindow(partition);
    this.win = win;
    win.on('closed', () => { if (this.win === win) this.win = null; });
    await win.loadURL(url);
  }

  async extract(): Promise<string> {
    if (!this.win) return '';
    const js = `(() => { const el = document.querySelector('article, main, [role=main]') || document.body; return el.innerText.slice(0, 20000); })()`;
    return (await this.win.webContents.executeJavaScript(js)) as string;
  }

  close(): void { this.win?.close(); this.win = null; }
  isOpen(): boolean { return this.win !== null; }
}
