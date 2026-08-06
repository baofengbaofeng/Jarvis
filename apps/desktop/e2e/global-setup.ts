import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN_ENTRY = join(DESKTOP_ROOT, 'out/main/index.js');

/** Build Electron main/preload (and renderer bundle) before real-shell E2E. */
export default async function globalSetup(): Promise<void> {
  if (!existsSync(MAIN_ENTRY) || process.env.CI) {
    execSync('pnpm exec electron-vite build', { cwd: DESKTOP_ROOT, stdio: 'inherit' });
  }
  // better-sqlite3 must match Electron's NODE_MODULE_VERSION or main bootstrap fails silently.
  execSync('pnpm exec electron-rebuild -f -w better-sqlite3', { cwd: DESKTOP_ROOT, stdio: 'inherit' });
}
