/**
 * Verify installer artifacts under dist/ match 1.0.0-Preview naming + GNU sha256 sidecars.
 * Used by CI and local release checks.
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const INSTALLER_ARTIFACTS = {
  winMsi: 'Jarvis_1.0.0-Preview_x86.msi',
  macDmgX64: 'Jarvis_1.0.0-Preview_x64.dmg',
  macDmgArm64: 'Jarvis_1.0.0-Preview_arm64.dmg',
};

const EXPECTED = Object.values(INSTALLER_ARTIFACTS);

function sha256File(path) {
  const buf = readFileSync(path);
  return createHash('sha256').update(buf).digest('hex');
}

function readChecksumSidecar(sidecarPath, artifactName) {
  const line = readFileSync(sidecarPath, 'utf8').trim();
  const m = /^([a-f0-9]{64})  (.+)$/.exec(line);
  if (!m) return { ok: false, error: `invalid checksum format in ${sidecarPath}` };
  if (m[2] !== artifactName) return { ok: false, error: `checksum filename mismatch in ${sidecarPath}` };
  return { ok: true, hash: m[1] };
}

/**
 * @param {string} distDir
 * @param {{ artifacts?: string[] }} [opts]
 * @returns {string[]} error messages (empty = pass)
 */
export function verifyArtifacts(distDir, opts = {}) {
  const errors = [];
  const names = opts.artifacts ?? EXPECTED;
  for (const name of names) {
    const artifactPath = join(distDir, name);
    const sidecarPath = `${artifactPath}.sha256`;
    if (!existsSync(artifactPath)) {
      errors.push(`missing artifact ${name}`);
      continue;
    }
    if (!existsSync(sidecarPath)) {
      errors.push(`missing checksum ${name}.sha256`);
      continue;
    }
    const parsed = readChecksumSidecar(sidecarPath, name);
    if (!parsed.ok) {
      errors.push(parsed.error);
      continue;
    }
    const actual = sha256File(artifactPath);
    if (actual !== parsed.hash) {
      errors.push(`checksum mismatch for ${name}`);
    }
  }
  return errors;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const distDir = process.argv[2] ?? join(process.cwd(), 'dist');
  const errors = verifyArtifacts(distDir);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log(`OK: artifacts verified under ${distDir}`);
}
