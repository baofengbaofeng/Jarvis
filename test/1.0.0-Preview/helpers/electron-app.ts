import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const HELPERS_DIR = dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = join(HELPERS_DIR, '../../../apps/desktop');
const require = createRequire(join(DESKTOP_ROOT, 'package.json'));
const ELECTRON_EXECUTABLE = require('electron') as string;
const MAIN_ENTRY = join(DESKTOP_ROOT, 'out/main/index.js');
const RENDERER_ORIGIN = process.env.ELECTRON_RENDERER_URL ?? 'http://127.0.0.1:5173';

/** HashRouter href for the Vite renderer (packaged file:// cannot use BrowserRouter paths). */
export function rendererHref(path = '/'): string {
  const origin = RENDERER_ORIGIN.replace(/\/$/, '');
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${origin}/#${normalized}`;
}

let portSeq = 17900;

export function createIsolatedDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'jarvis-e2e-'));
}

export function removeDataDir(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

export interface LaunchedJarvis {
  app: ElectronApplication;
  window: Page;
  dataDir: string;
}

/** Ensure the Electron main process exits (macOS keeps apps alive after window close). */
export async function closeJarvisElectron(app: ElectronApplication): Promise<void> {
  try {
    await app.evaluate(async ({ app: electronApp }) => { electronApp.quit(); });
  } catch { /* process may already be gone */ }
  await app.close();
}

/** Launch the real Electron shell (main + preload + IPC) against the Vite renderer dev server. */
export async function launchJarvisElectron(dataDir?: string): Promise<LaunchedJarvis> {
  const isolated = dataDir ?? createIsolatedDataDir();
  const daemonPort = portSeq++;
  const env: Record<string, string | undefined> = {
    ...process.env,
    JARVIS_E2E: '1',
    JARVIS_DATA_DIR: isolated,
    JARVIS_DAEMON_PORT: String(daemonPort),
    JARVIS_ALLOW_LOOPBACK_URLS: '1',
    NODE_TLS_REJECT_UNAUTHORIZED: '0',
    ELECTRON_RENDERER_URL: RENDERER_ORIGIN,
    NODE_ENV: 'test',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: ELECTRON_EXECUTABLE,
    args: [MAIN_ENTRY],
    cwd: DESKTOP_ROOT,
    env: env as NodeJS.ProcessEnv,
  });
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  return { app, window, dataDir: isolated };
}

export async function completeOnboarding(window: Page): Promise<void> {
  await window.goto(rendererHref('/onboarding'));
  await window.getByTestId('onboarding').waitFor({ timeout: 30_000 });
  await window.getByTestId('onboarding-next').click();
  await window.getByTestId('onboarding-next').click();
  await window.getByTestId('onboarding-finish').click();
  await window.getByTestId('chat-page').waitFor({ timeout: 30_000 });
}
