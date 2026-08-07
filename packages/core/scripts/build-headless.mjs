#!/usr/bin/env node
/**
 * DAEM-01: produce packages/core/dist/headless.mjs from the source entry.
 * No bundler required — the headless CLI is plain Node ESM.
 */
import { copyFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src', 'headless.mjs');
const distDir = join(root, 'dist');
const dest = join(distDir, 'headless.mjs');

if (!existsSync(src)) {
  console.error(`build-headless: missing source ${src}`);
  process.exit(1);
}

mkdirSync(distDir, { recursive: true });
copyFileSync(src, dest);
chmodSync(dest, 0o755);
console.log(`wrote ${dest}`);
