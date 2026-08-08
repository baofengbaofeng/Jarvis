import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { appResourcePath } from './appIconPath';

describe('appResourcePath', () => {
  it('resolves under resources/ in development', () => {
    const dirname = '/repo/apps/desktop/src/main/assets';
    expect(appResourcePath('icon.png', dirname, false, '')).toBe(
      join('/repo/apps/desktop/resources', 'icon.png'),
    );
  });

  it('resolves under process.resourcesPath when packaged', () => {
    expect(appResourcePath('tray-icon.png', '/ignored', true, '/App/Resources')).toBe(
      join('/App/Resources', 'tray-icon.png'),
    );
  });
});
