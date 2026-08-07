import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '../../../package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

describe('package scripts (BUILD-03)', () => {
  it('build:daemon builds both jarvis-daemon and jarvis-agent into resources/daemon', () => {
    const s = pkg.scripts['build:daemon'] ?? '';
    expect(s).toMatch(/jarvis-daemon/);
    expect(s).toMatch(/jarvis-agent/);
    expect(s).toMatch(/resources\/daemon/);
  });

  it('cross-compile daemon scripts also build jarvis-agent', () => {
    for (const name of ['build:daemon:win', 'build:daemon:darwin:x64', 'build:daemon:darwin:arm64'] as const) {
      const s = pkg.scripts[name] ?? '';
      expect(s, name).toMatch(/jarvis-agent/);
    }
  });

  it.each([
    ['package:win', 'build:daemon:win'],
    ['package:mac:x64', 'build:daemon:darwin:x64'],
    ['package:mac:arm64', 'build:daemon:darwin:arm64'],
  ] as const)('%s depends on %s before electron-builder', (pkgName, daemonScript) => {
    const s = pkg.scripts[pkgName] ?? '';
    expect(s).toMatch(new RegExp(daemonScript.replace(/:/g, '\\:')));
    // Also accept generic build:daemon as a dependency name in the script text
    expect(s).toMatch(/build:daemon/);
    const daemonIdx = s.search(/build:daemon/);
    const builderIdx = s.indexOf('electron-builder');
    expect(daemonIdx).toBeGreaterThanOrEqual(0);
    expect(builderIdx).toBeGreaterThan(daemonIdx);
  });
});
