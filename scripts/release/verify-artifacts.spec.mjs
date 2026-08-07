import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyArtifacts, INSTALLER_ARTIFACTS } from './verify-artifacts.mjs';

function writeArtifact(dir, name, bytes) {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  const hash = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(`${path}.sha256`, `${hash}  ${name}\n`, 'utf8');
}

test('verifyArtifacts passes for matching GNU sha256 sidecars', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-dist-'));
  writeArtifact(dir, INSTALLER_ARTIFACTS.winMsi, Buffer.from('msi-bytes'));
  assert.deepEqual(verifyArtifacts(dir, { artifacts: [INSTALLER_ARTIFACTS.winMsi] }), []);
});

test('verifyArtifacts reports missing artifacts and checksum mismatches', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-dist-'));
  mkdirSync(dir, { recursive: true });
  const errors = verifyArtifacts(dir, { artifacts: [INSTALLER_ARTIFACTS.macDmgX64] });
  assert.ok(errors.some((e) => e.includes('missing artifact')));
  writeArtifact(dir, INSTALLER_ARTIFACTS.macDmgX64, Buffer.from('dmg'));
  const wrongNameHash = 'a'.repeat(64);
  writeFileSync(join(dir, `${INSTALLER_ARTIFACTS.macDmgX64}.sha256`), `${wrongNameHash}  wrong-name.dmg\n`);
  const badName = verifyArtifacts(dir, { artifacts: [INSTALLER_ARTIFACTS.macDmgX64] });
  assert.ok(badName.some((e) => e.includes('filename mismatch')));
});
